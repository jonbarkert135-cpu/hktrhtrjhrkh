# NEXUS — 10 — INTEGRATION FRAMEWORK

## Scope

Specifies the **generic, tool-agnostic** integration subsystem: the eight-stage pipeline from
`00_MASTER.md` §2.3 with full TypeScript contracts, the Integration Manifest zod schema, the
Runner service (job protocol, sandbox, egress proxy, secrets, artifacts), the run lifecycle and
its UX contract, entity extraction/resolution/dedupe, the error taxonomy, and the legal gate.
Tool-specific behaviour lives in `11_GITHUB.md`, `12_SPIDERFOOT.md`, `13_SHERLOCK.md`; third-party
extensibility lives in `17_PLUGIN_SDK.md`. Ships in phase **P9**.
Non-goal: AI-generated proposals (`14_AI_AGENT.md`), which reuse the same Proposal/Apply layer.

---

## 1. Design rules for this subsystem

| #   | Rule                                                                                      | Consequence in code                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The application core contains **zero** tool-specific code                                 | `apps/api`, `apps/web`, `packages/canvas-engine` must not reference `github`/`sherlock`/`spiderfoot` identifiers; enforced by an eslint `no-restricted-syntax` rule listed in §14.4 |
| R2  | Adding a tool = adding a manifest + a parser module in `packages/integrations/<id>/`      | no migration, no rebuild of the canvas                                                                                                                                              |
| R3  | Every run output reaches the graph only through an `ImportProposal` the user accepts (N4) | `applyProposal()` is the single write path                                                                                                                                          |
| R4  | Every tool executes in the Runner sandbox, never in the API process (N5)                  | `apps/api` has no `child_process`/`node:child_process` import; architecture test in `18_TESTING.md` §7                                                                              |
| R5  | Upstream tool changes must be absorbable by editing **one** parser module                 | parsers consume raw artifacts, not tool internals; every parser is version-gated (§4.6)                                                                                             |
| R6  | Nothing runs without an explicit, recorded consent for the target scope                   | §12                                                                                                                                                                                 |
| R7  | Every node/edge produced carries full provenance                                          | §8.5, enforced by zod at proposal construction                                                                                                                                      |

### 1.1 Package layout

```text
packages/integrations/
├─ src/
│  ├─ index.ts                     registry loader, manifest validation
│  ├─ manifest.ts                  zod schema (§4) + types
│  ├─ pipeline.ts                  stage interfaces (§3) + orchestrator
│  ├─ extract/
│  │  ├─ normalizers.ts            per-entity-kind normalizers (§8.1)
│  │  ├─ patterns.ts               regex corpus for the generic extractor
│  │  └─ confidence.ts             confidence model (§8.4)
│  ├─ resolve/
│  │  ├─ identity.ts               identity keys (§8.2)
│  │  └─ merge.ts                  dedupe/merge policy (§8.3)
│  ├─ errors.ts                    error taxonomy (§11)
│  └─ testkit/                     manifest + parser conformance harness
├─ github/     { manifest.ts, parser.ts, fixtures/ }      → 11_GITHUB.md
├─ sherlock/   { manifest.ts, parser.ts, fixtures/ }      → 13_SHERLOCK.md
└─ spiderfoot/ { manifest.ts, parser.ts, fixtures/ }      → 12_SPIDERFOOT.md

apps/runner/
├─ src/
│  ├─ main.ts                worker bootstrap, BullMQ consumer
│  ├─ executors/{container.ts,http.ts,builtin.ts}
│  ├─ sandbox/{flags.ts,egress-proxy.ts,secrets.ts}
│  ├─ artifacts.ts           S3 streaming + size caps
│  ├─ runlog.ts              structured run log writer
│  └─ cancel.ts              cooperative + hard cancellation
```

`packages/integrations` depends only on `packages/domain` and `packages/config`. It **may not**
import from `apps/*` (dependency-cruiser rule `integrations-no-app`).

---

## 2. Pipeline overview

```text
 user intent (node selection / manual form)
        │
        ▼
 ┌───────────────┐   IntegrationInput      ┌────────────────┐   RawRunResult
 │ InputAdapter  │ ──────────────────────► │ ExecutionLayer │ ──────────────►
 └───────────────┘                         └────────────────┘
        │                                          │ artifacts → S3
        │                                          ▼
 ┌───────────────┐   ParsedDocument        ┌────────────────┐
 │ OutputParser  │ ◄────────────────────── │  Runner service│
 └───────────────┘                         └────────────────┘
        │ ParsedDocument
        ▼
 ┌────────────────┐  ExtractedEntity[]  ┌──────────────┐  ProposedNode[]
 │ EntityExtractor│ ──────────────────► │  NodeMapper  │ ─────────────────┐
 └────────────────┘                     └──────────────┘                  │
        │                                                                 ▼
        │                               ┌────────────────────┐   ┌────────────────┐
        └──────────────────────────────►│ RelationshipMapper │──►│ ImportProposal │
                                        └────────────────────┘   └────────────────┘
                                                                          │ user accepts
                                                                          ▼
                                                                    ┌──────────┐
                                                                    │ Applier  │→ Y.Doc
                                                                    └──────────┘
```

Stages 1–2 run **server-side** (API enqueues, Runner executes). Stages 3–7 run **in the worker**
(`apps/worker`, queue `integration.parse`) because parsing may be CPU-heavy and must not block the
Runner's sandbox slot. Stage 8 (`Applier`) runs **client-side** against the local `Y.Doc`, so that
undo (`Y.UndoManager`) covers the import as one transaction (N3).

Rationale for splitting parse out of the runner: the runner container slot is the scarce, expensive
resource (gVisor, memory caps); parsing a 40 MB SpiderFoot JSON in the same slot would halve run
throughput.

---

## 3. Stage contracts (`packages/integrations/src/pipeline.ts`)

All types are `readonly` where practical and validated with zod at every process boundary.

### 3.1 Shared primitives

```ts
export type IntegrationId = string; // manifest.id, e.g. "sherlock"
export type RunId = string; // uuidv7, sortable by time
export type EntityKind =
  | 'domain'
  | 'url'
  | 'email'
  | 'username'
  | 'ip'
  | 'hash'
  | 'phone'
  | 'handle'
  | 'repo'
  | 'person'
  | 'organization'
  | 'file'
  | 'note'
  | 'unknown';

export interface Provenance {
  readonly source: string; // human label, e.g. "sherlock v0.16.0"
  readonly tool: IntegrationId;
  readonly toolVersion: string; // manifest.version
  readonly runId: RunId;
  readonly observedAt: string; // ISO-8601 UTC, when the tool observed it
  readonly importedAt: string; // ISO-8601 UTC, when the proposal was applied
  readonly confidence: number; // 0..1, see §8.4
  readonly artifactRef?: ArtifactRef; // raw payload
  readonly pointer?: string; // JSON Pointer into the artifact, e.g. "/results/12"
  readonly actorUserId: string; // who started the run
}

export interface ArtifactRef {
  readonly bucket: string;
  readonly key: string; // runs/<runId>/<name>.<ext>
  readonly bytes: number;
  readonly sha256: string;
  readonly contentType: string;
  readonly truncated: boolean; // true if the output size cap was hit (§6.8)
}
```

### 3.2 InputAdapter

Turns a user intent (selected nodes and/or a form) into the manifest-typed input object.

```ts
export interface IntegrationInvocation {
  readonly integrationId: IntegrationId;
  readonly boardId: string;
  readonly selection: readonly GraphNodeRef[]; // may be empty for manual runs
  readonly formValues: Record<string, unknown>; // raw values from the config form
  readonly actorUserId: string;
}

export interface GraphNodeRef {
  readonly id: string;
  readonly kind: EntityKind;
  readonly label: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export interface InputAdapterResult<I = Record<string, unknown>> {
  readonly input: I; // validated against manifest.inputs schema
  readonly targets: readonly ResolvedTarget[]; // for the legal gate + rate limiter (§12)
  readonly warnings: readonly UserMessage[];
}

export interface ResolvedTarget {
  readonly kind: EntityKind;
  readonly value: string; // normalized (§8.1)
  readonly scope: TargetScope; // 'public-index' | 'owned-asset' | 'third-party-host'
}

export interface InputAdapter<I = Record<string, unknown>> {
  /** Pure. Must not perform I/O. Throws IntegrationError('INPUT_INVALID'). */
  adapt(inv: IntegrationInvocation): InputAdapterResult<I>;
  /** Which selections make the "Run" action available in the UI. */
  accepts(selection: readonly GraphNodeRef[]): boolean;
}
```

Default implementation `manifestInputAdapter(manifest)` derives everything from
`manifest.inputs`: each input declares `from: { selection: EntityKind[] } | { form: true }`, so
most integrations need **no custom adapter**. A custom adapter is only allowed when the tool needs
derived inputs (e.g. "domain of the selected URL").

### 3.3 ExecutionLayer

```ts
export interface ExecutionRequest<I = unknown> {
  readonly runId: RunId;
  readonly manifest: IntegrationManifest;
  readonly input: I;
  readonly secretsRef: readonly string[]; // secret names to inject (§6.6)
  readonly limits: EffectiveLimits; // merged manifest + org policy
  readonly cancelToken: string; // Redis key watched by the runner
}

export interface EffectiveLimits {
  readonly wallClockMs: number;
  readonly cpuMillicores: number;
  readonly memoryMiB: number;
  readonly pids: number;
  readonly maxOutputBytes: number;
  readonly maxArtifacts: number;
  readonly egressAllowlist: readonly string[]; // host patterns
  readonly maxRequestsPerMinute: number;
}

export type RunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'parsing'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface RawRunResult {
  readonly runId: RunId;
  readonly status: Exclude<RunStatus, 'queued' | 'starting' | 'running' | 'parsing'>;
  readonly exitCode: number | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly artifacts: readonly ArtifactRef[]; // primary output first
  readonly stdoutRef?: ArtifactRef;
  readonly stderrRef?: ArtifactRef;
  readonly stats: {
    readonly bytesOut: number;
    readonly egressRequests: number;
    readonly egressDenied: number;
    readonly peakMemMiB: number;
  };
  readonly error?: IntegrationErrorPayload; // §11
}

export interface ExecutionLayer {
  execute(req: ExecutionRequest): Promise<RawRunResult>;
  cancel(runId: RunId): Promise<void>;
}
```

Three implementations, selected by `manifest.execution.kind`:

| kind        | class               | use                                                          |
| ----------- | ------------------- | ------------------------------------------------------------ |
| `container` | `ContainerExecutor` | CLI tools (Sherlock, SpiderFoot CLI)                         |
| `http`      | `HttpExecutor`      | hosted APIs (GitHub REST/GraphQL) — SSRF-guarded per N7      |
| `builtin`   | `BuiltinExecutor`   | pure in-process transforms shipped by us (e.g. "expand URL") |

`builtin` is still executed inside the Runner service (N5), just without a container; it is limited
to modules registered in `apps/runner/src/executors/builtin-registry.ts` and cannot be contributed
by third parties (`17_PLUGIN_SDK.md` §5.3).

### 3.4 OutputParser

```ts
export interface ParseContext {
  readonly manifest: IntegrationManifest;
  readonly runId: RunId;
  readonly input: unknown;
  readonly readArtifact: (ref: ArtifactRef) => Promise<Readable>;
  readonly logger: RunLogger;
}

export interface ParsedRecord {
  readonly type: string; // parser-defined record type, e.g. "site_hit"
  readonly data: Readonly<Record<string, unknown>>;
  readonly pointer: string; // JSON Pointer into the artifact
  readonly observedAt: string;
  readonly parserConfidence: number; // 0..1 base confidence for this record
}

export interface ParsedDocument {
  readonly toolReportedVersion?: string;
  readonly records: readonly ParsedRecord[];
  readonly counters: Readonly<Record<string, number>>; // shown in the run log
  readonly nonFatalIssues: readonly UserMessage[];
}

export interface OutputParser {
  readonly schemaVersions: readonly string[]; // tool output versions supported
  parse(res: RawRunResult, ctx: ParseContext): Promise<ParsedDocument>;
}
```

Parsers must be **streaming** for artifacts > 8 MiB (`stream-json` over the S3 read stream) and must
never `JSON.parse` an unbounded string. A parser that encounters an unknown structure emits a
`nonFatalIssue` and skips that record — it never throws for a single bad record. It throws
`IntegrationError('PARSE_UNSUPPORTED_SHAPE')` only if it cannot recognize the document at all.

### 3.5 EntityExtractor

```ts
export interface ExtractedEntity {
  readonly kind: EntityKind;
  readonly value: string; // normalized canonical value (§8.1)
  readonly display: string; // original form, for the UI
  readonly props: Readonly<Record<string, unknown>>;
  readonly identityKey: string; // §8.2
  readonly confidence: number; // §8.4
  readonly origin: { recordIndex: number; pointer: string; field?: string };
}

export interface ExtractedRelation {
  readonly fromKey: string; // identityKey
  readonly toKey: string;
  readonly type: EdgeType; // from packages/domain (07_EDGE_SYSTEM.md §2)
  readonly props?: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly origin: { recordIndex: number; pointer: string };
}

export interface ExtractionResult {
  readonly entities: readonly ExtractedEntity[];
  readonly relations: readonly ExtractedRelation[];
  readonly issues: readonly UserMessage[];
}

export interface EntityExtractor {
  extract(doc: ParsedDocument, ctx: ParseContext): ExtractionResult;
}
```

Default implementation `manifestEntityExtractor(manifest)` executes `manifest.entityMappings`
declaratively (§4.5); a custom extractor is only needed for tools whose records require
cross-record joins (SpiderFoot correlations are the known case, `12_SPIDERFOOT.md` §6).

### 3.6 NodeMapper / RelationshipMapper

```ts
export interface ProposedNode {
  readonly tempId: string; // "n:<identityKey hash>"
  readonly identityKey: string;
  readonly nodeType: NodeType; // 06_NODE_SYSTEM.md §3 registry key
  readonly title: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly tags: readonly string[];
  readonly provenance: Provenance;
  readonly layoutHint?: { anchorNodeId?: string; ring: number; index: number };
}

export interface ProposedEdge {
  readonly tempId: string;
  readonly fromRef: NodeRefOrTemp;
  readonly toRef: NodeRefOrTemp;
  readonly edgeType: EdgeType;
  readonly label?: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
}

export type NodeRefOrTemp =
  | { readonly kind: 'existing'; readonly nodeId: string }
  | { readonly kind: 'temp'; readonly tempId: string };

export interface NodeMapper {
  map(e: ExtractionResult, ctx: MapContext): readonly ProposedNode[];
}
export interface RelationshipMapper {
  map(
    e: ExtractionResult,
    nodes: readonly ProposedNode[],
    ctx: MapContext,
  ): readonly ProposedEdge[];
}

export interface MapContext {
  readonly boardId: string;
  readonly anchorNodeId?: string; // the node the run was launched from
  readonly resolve: (identityKey: string) => ExistingNodeMatch | undefined; // §8.3
  readonly provenanceFor: (origin: { pointer: string }, confidence: number) => Provenance;
}
```

`layoutHint` is advisory: the Applier places new nodes in concentric rings around `anchorNodeId`
using the radial placement algorithm in `05_CANVAS_ENGINE.md` §9.3 (ring radius
`180 + ring * 140` px, angular slot `2π / max(6, count)`), never overlapping existing nodes.

### 3.7 ImportProposal

```ts
export type ProposalItemKind = 'new_node' | 'new_edge' | 'enrich' | 'conflict';

export interface ProposalItemBase {
  readonly id: string; // stable within the proposal
  readonly kind: ProposalItemKind;
  readonly selectedByDefault: boolean;
  readonly confidence: number;
  readonly explain: string; // one sentence, why this item exists
}

export interface NewNodeItem extends ProposalItemBase {
  readonly kind: 'new_node';
  readonly node: ProposedNode;
}
export interface NewEdgeItem extends ProposalItemBase {
  readonly kind: 'new_edge';
  readonly edge: ProposedEdge;
}
export interface EnrichItem extends ProposalItemBase {
  readonly kind: 'enrich';
  readonly targetNodeId: string;
  readonly fieldPatches: readonly FieldPatch[];
}
export interface ConflictItem extends ProposalItemBase {
  readonly kind: 'conflict';
  readonly targetNodeId: string;
  readonly field: string;
  readonly currentValue: unknown;
  readonly incomingValue: unknown;
  readonly currentProvenance?: Provenance;
  readonly incomingProvenance: Provenance;
  readonly resolution: 'keep' | 'replace' | 'keep_both'; // user-editable, default 'keep'
}

export interface FieldPatch {
  readonly path: string; // JSON Pointer into node.props
  readonly op: 'set' | 'append' | 'addToSet';
  readonly value: unknown;
  readonly previous?: unknown;
}

export interface ImportProposal {
  readonly id: string;
  readonly runId: RunId;
  readonly integrationId: IntegrationId;
  readonly boardId: string;
  readonly createdAt: string;
  readonly summary: {
    readonly newNodes: number;
    readonly newEdges: number;
    readonly enriched: number;
    readonly conflicts: number;
    readonly skippedDuplicates: number;
  };
  readonly items: readonly ProposalItem[];
  readonly issues: readonly UserMessage[];
  readonly expiresAt: string; // now + 7 days; after that, re-run is required
}
export type ProposalItem = NewNodeItem | NewEdgeItem | EnrichItem | ConflictItem;
```

Proposals are stored in Postgres (`import_proposals`, `08_DATA_MODEL.md` §7) so the user can close
the tab and return. They are immutable except for per-item `selected` and `resolution`, which are
kept client-side until apply.

### 3.8 Applier

```ts
export interface ApplyOptions {
  readonly selectedItemIds: readonly string[];
  readonly conflictResolutions: Readonly<Record<string, 'keep' | 'replace' | 'keep_both'>>;
  readonly placement: 'radial' | 'grid' | 'manual';
}

export interface ApplyResult {
  readonly createdNodeIds: readonly string[];
  readonly createdEdgeIds: readonly string[];
  readonly patchedNodeIds: readonly string[];
  readonly undoStackEntryId: string;
  readonly skipped: readonly { itemId: string; reason: string }[];
}

export interface Applier {
  apply(p: ImportProposal, o: ApplyOptions): ApplyResult; // synchronous, client-side
}
```

Implementation constraints:

1. All mutations happen inside **one** `ydoc.transact(fn, LOCAL_ORIGIN)` so `Y.UndoManager`
   produces a single undo entry labelled `Import from <integration> (<n> items)` (N3).
2. Node ids are generated client-side (uuidv7); `tempId → realId` map is returned and persisted to
   the proposal row so a later re-run can diff against what was actually applied (§7.6).
3. If a referenced `existing` node was deleted between proposal creation and apply, the item is
   skipped with reason `target_missing` and reported in the apply toast.
4. Apply is idempotent per `(proposalId, itemId)`: re-applying an already-applied item is a no-op
   (guard map stored on the proposal row).

---

## 4. Integration Manifest

`packages/integrations/src/manifest.ts`. The manifest is the _only_ declaration of a tool. It is
validated at build time (unit test over every shipped manifest) and again at load time.

### 4.1 Full zod schema

```ts
import { z } from 'zod';

export const zSemver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/);
export const zEntityKind = z.enum([
  'domain',
  'url',
  'email',
  'username',
  'ip',
  'hash',
  'phone',
  'handle',
  'repo',
  'person',
  'organization',
  'file',
  'note',
  'unknown',
]);

export const zIntegrationId = z.string().regex(/^[a-z][a-z0-9-]{2,31}$/);

/* ---------- inputs ---------- */
export const zInputField = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(80),
  help: z.string().max(240).optional(),
  type: z.enum([
    'string',
    'number',
    'boolean',
    'enum',
    'entity',
    'entityList',
    'duration',
    'secretRef',
  ]),
  entityKinds: z.array(zEntityKind).optional(), // for type 'entity'/'entityList'
  enumValues: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  required: z.boolean().default(true),
  default: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxItems: z.number().int().positive().max(1000).optional(),
  pattern: z.string().optional(), // RE2-safe subset, validated in tests
  from: z
    .discriminatedUnion('source', [
      z.object({ source: z.literal('selection'), kinds: z.array(zEntityKind).min(1) }),
      z.object({ source: z.literal('form') }),
      z.object({ source: z.literal('derived'), expr: z.string() }), // e.g. "domainOf(url)"
    ])
    .default({ source: 'form' }),
  advanced: z.boolean().default(false), // hidden behind "Advanced" in the form
});

/* ---------- outputs ---------- */
export const zOutputSpec = z.object({
  name: z.string(), // artifact logical name
  kind: z.enum(['json', 'ndjson', 'csv', 'text', 'html', 'binary']),
  path: z.string().optional(), // path inside the container workdir
  fromStdout: z.boolean().default(false),
  primary: z.boolean().default(false),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024 * 1024)
    .default(64 * 1024 * 1024),
});

/* ---------- permissions ---------- */
export const zPermission = z.enum([
  'net:allowlist', // egress to manifest.execution.network.allow only
  'net:broad', // egress to any public host (requires org policy opt-in)
  'graph:read', // read selected nodes as input
  'graph:propose', // create import proposals (always required)
  'secrets:read', // receive named secrets
  'files:read', // read a board file artifact as input
  'files:write', // store produced files as board attachments
]);

/* ---------- execution ---------- */
export const zNetworkPolicy = z.object({
  mode: z.enum(['none', 'allowlist', 'broad']),
  allow: z.array(z.string()).default([]), // host patterns: "api.github.com", "*.example.org"
  denyPrivateRanges: z.literal(true), // never configurable; N7
  maxRequestsPerMinute: z.number().int().positive().max(6000).default(120),
  maxConcurrentConnections: z.number().int().positive().max(64).default(16),
});

export const zResourceLimits = z.object({
  wallClockMs: z
    .number()
    .int()
    .min(1000)
    .max(3 * 60 * 60 * 1000)
    .default(300_000),
  cpuMillicores: z.number().int().min(100).max(4000).default(1000),
  memoryMiB: z.number().int().min(64).max(8192).default(512),
  pids: z.number().int().min(16).max(2048).default(256),
  tmpfsMiB: z.number().int().min(16).max(4096).default(256),
  maxOutputBytes: z
    .number()
    .int()
    .min(1024)
    .max(512 * 1024 * 1024)
    .default(64 * 1024 * 1024),
  maxArtifacts: z.number().int().min(1).max(64).default(8),
});

export const zExecution = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('container'),
    image: z.string().min(3), // "sherlock/sherlock"
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), // pinned, mandatory
    entrypoint: z.array(z.string()).optional(),
    command: z.array(z.string()).min(1), // templated: "{{input.username}}", "{{workdir}}/out.json"
    env: z.record(z.string(), z.string()).default({}), // templated, no secrets here
    secretEnv: z.record(z.string(), z.string()).default({}), // envVar -> secret name (§6.6)
    workdir: z.string().default('/work'),
    network: zNetworkPolicy,
    limits: zResourceLimits,
    runtimeClass: z.enum(['runc', 'gvisor']).default('gvisor'),
    user: z.string().default('65534:65534'),
    readOnlyRootFs: z.literal(true),
  }),
  z.object({
    kind: z.literal('http'),
    baseUrl: z.string().url(),
    requests: z
      .array(
        z.object({
          name: z.string(),
          method: z.enum(['GET', 'POST']),
          path: z.string(), // templated
          query: z.record(z.string(), z.string()).default({}),
          headers: z.record(z.string(), z.string()).default({}),
          secretHeaders: z.record(z.string(), z.string()).default({}), // header -> secret name
          body: z.unknown().optional(),
          paginate: z
            .object({
              style: z.enum(['link-header', 'cursor', 'page']),
              cursorPath: z.string().optional(),
              maxPages: z.number().int().min(1).max(200).default(10),
            })
            .optional(),
          collectAs: z.string(), // artifact name
        }),
      )
      .min(1),
    network: zNetworkPolicy,
    limits: zResourceLimits,
  }),
  z.object({
    kind: z.literal('builtin'),
    module: z.string(), // key in builtin-registry.ts
    limits: zResourceLimits,
  }),
]);

/* ---------- entity mappings ---------- */
export const zFieldMap = z.object({
  from: z.string(), // JSON Pointer inside ParsedRecord.data
  to: z.string(), // node prop path
  transform: z
    .enum(['none', 'lower', 'trim', 'url-normalize', 'domain-of', 'strip-at', 'sha256'])
    .default('none'),
  required: z.boolean().default(false),
});

export const zEntityMapping = z.object({
  when: z.object({ recordType: z.string() }),
  entity: z.object({
    kind: zEntityKind,
    valueFrom: z.string(), // JSON Pointer to the identity value
    nodeType: z.string(), // 06_NODE_SYSTEM.md registry key
    titleFrom: z.string().optional(),
    fields: z.array(zFieldMap).default([]),
    tags: z.array(z.string()).default([]),
    baseConfidence: z.number().min(0).max(1).default(0.7),
  }),
  relate: z
    .array(
      z.object({
        to: z.enum(['anchor', 'entity']),
        toEntityRef: z.string().optional(), // another mapping's entity id when to==='entity'
        edgeType: z.string(), // 07_EDGE_SYSTEM.md registry key
        label: z.string().optional(),
        direction: z.enum(['out', 'in']).default('out'),
      }),
    )
    .default([]),
  id: z.string().optional(), // referenced by toEntityRef
});

/* ---------- rate & cost ---------- */
export const zRateLimits = z.object({
  perUserPerHour: z.number().int().min(1).max(1000).default(20),
  perOrgPerHour: z.number().int().min(1).max(10000).default(200),
  perTargetPerDay: z.number().int().min(1).max(1000).default(5), // abuse guard, §12.3
  concurrentRunsPerOrg: z.number().int().min(1).max(50).default(3),
  minIntervalMsSameInput: z.number().int().min(0).max(86_400_000).default(60_000),
});

export const zCostHints = z.object({
  typicalDurationMs: z.number().int().positive(),
  typicalOutboundRequests: z.number().int().nonnegative(),
  typicalNewNodes: z.number().int().nonnegative(),
  billable: z.boolean().default(false),
  billingNote: z.string().max(200).optional(),
});

/* ---------- top level ---------- */
export const zIntegrationManifest = z
  .object({
    manifestVersion: z.literal(1),
    id: zIntegrationId,
    name: z.string().min(2).max(60),
    version: zSemver, // OUR adapter version, not the tool's
    toolVersion: z.string().max(40), // upstream tool version this adapter targets
    publisher: z.object({
      name: z.string(),
      url: z.string().url().optional(),
      verified: z.boolean().default(false),
    }),
    icon: z.string(), // path in packages/ui/icons or data: URI ≤ 8 KiB
    repository: z.string().url(),
    license: z.string(), // SPDX id of the upstream tool
    description: z.string().min(20).max(400),
    documentationUrl: z.string().url().optional(),
    capabilities: z
      .array(
        z.enum([
          'enumerate-usernames',
          'scan-domain',
          'fetch-repo',
          'resolve-dns',
          'whois',
          'search-web',
          'extract-metadata',
          'analyze-file',
          'enrich-entity',
        ]),
      )
      .min(1),
    inputs: z.array(zInputField).max(24),
    outputs: z.array(zOutputSpec).min(1).max(16),
    permissions: z.array(zPermission).min(1),
    execution: zExecution,
    parser: z.object({
      module: z.string(), // "@nexus/integrations/sherlock/parser"
      export: z.string().default('parser'),
      supportedOutputVersions: z.array(z.string()).min(1),
    }),
    entityMappings: z.array(zEntityMapping).default([]),
    rateLimits: zRateLimits,
    costHints: zCostHints,
    maturity: z.enum(['experimental', 'beta', 'stable', 'deprecated']),
    risk: z.object({
      label: z.enum(['low', 'medium', 'high']),
      reasons: z.array(z.string()).default([]), // shown in the consent dialog
      upstreamMaintenance: z.enum(['active', 'low', 'unmaintained', 'unknown']),
      fallback: z.string().max(300).optional(), // what happens if the tool is unavailable
    }),
    consent: z.object({
      required: z.boolean().default(true),
      scopeText: z.string().min(20).max(600), // exact checkbox copy, §12.1
      allowedTargetScopes: z
        .array(z.enum(['public-index', 'owned-asset', 'third-party-host']))
        .min(1),
    }),
  })
  .superRefine((m, ctx) => {
    if (
      m.execution.kind !== 'builtin' &&
      m.execution.network.mode === 'broad' &&
      !m.permissions.includes('net:broad')
    ) {
      ctx.addIssue({ code: 'custom', message: 'network.mode=broad requires permission net:broad' });
    }
    if (m.outputs.filter((o) => o.primary).length !== 1) {
      ctx.addIssue({ code: 'custom', message: 'exactly one output must be primary' });
    }
  });

export type IntegrationManifest = z.infer<typeof zIntegrationManifest>;
```

### 4.2 Command templating

Templates use `{{ ... }}` with a whitelist of roots: `input.*`, `workdir`, `runId`, `secretFile.*`.
Rendering rules (`apps/runner/src/executors/container.ts`):

1. Each `command` array element is rendered **independently**; no shell is ever invoked
   (`execFile`-style argv, no `/bin/sh -c`). Shell metacharacters therefore have no meaning.
2. A template that resolves to an array (e.g. `{{input.usernames}}`) expands in place into multiple
   argv entries; each element is coerced with `String()` and validated against the input field's
   `pattern` before expansion.
3. Unresolvable template → `IntegrationError('MANIFEST_TEMPLATE_UNRESOLVED')`, run never starts.
4. `secretFile.NAME` renders to a path inside the tmpfs (`/run/secrets/NAME`) — secret _values_
   can never appear in argv (§6.6).

### 4.3 Manifest registry & loading

```ts
export interface RegistryEntry {
  manifest: IntegrationManifest;
  parser: OutputParser;
  inputAdapter: InputAdapter;
  extractor: EntityExtractor;
  nodeMapper: NodeMapper;
  relationshipMapper: RelationshipMapper;
  enabledForOrg(orgId: string): Promise<boolean>;
}
export function loadRegistry(opts: {
  includeThirdParty: boolean;
}): Promise<Map<IntegrationId, RegistryEntry>>;
```

Built-in manifests are statically imported (tree-shakeable, no dynamic `require`). Third-party
manifests come from the plugin registry and are validated with the _same_ schema plus the plugin
superset (`17_PLUGIN_SDK.md` §2). A manifest that fails validation is skipped and surfaced in
Admin → Integrations with the zod issue path; it never crashes boot.

### 4.4 Org-level policy overlay

Admins may tighten (never loosen) a manifest through `integration_policies` rows:

```sql
CREATE TABLE integration_policies (
  org_id            uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  integration_id    text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  max_wall_clock_ms integer,
  max_memory_mib    integer,
  network_allow     text[],        -- intersected with manifest allow
  per_user_per_hour integer,
  allowed_scopes    text[],        -- subset of manifest.consent.allowedTargetScopes
  require_approver  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (org_id, integration_id)
);
```

Effective limits = `min(manifest, policy)` per numeric field, `intersection` per list field.
`require_approver = true` puts runs in status `awaiting_approval` until a project admin approves
(§7.2 step 3a).

### 4.5 Declarative mapping semantics

For each `ParsedRecord`, the extractor finds mappings whose `when.recordType` equals
`record.type`. For each match:

```text
value  := normalize(kind, jsonPointer(record.data, entity.valueFrom))
if value is empty → emit issue "mapping <id>: empty identity value at <pointer>", skip
key    := identityKey(kind, value)                                   // §8.2
props  := {}
for f in entity.fields:
    raw := jsonPointer(record.data, f.from)
    if raw == null and f.required → issue + skip record
    if raw != null → props[f.to] := transform(f.transform, raw)
conf   := clamp(entity.baseConfidence * record.parserConfidence * kindPenalty(kind), 0, 1)
emit ExtractedEntity{kind, value, display, props, identityKey: key, confidence: conf, origin}
for r in relate:
    target := r.to === 'anchor' ? anchorKey : keyOf(r.toEntityRef in this record)
    emit ExtractedRelation{ from/to per direction, type: r.edgeType, confidence: conf }
```

### 4.6 Version gating

`parser.supportedOutputVersions` is matched against `ParsedDocument.toolReportedVersion` (or, when
the tool does not report one, against `manifest.toolVersion`). Mismatch behaviour:

| Case              | Behaviour                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| exact match       | normal                                                                                                                                      |
| patch-level drift | parse normally, add non-fatal issue "tool version X, adapter targets Y"                                                                     |
| minor/major drift | parse in **tolerant mode** (unknown fields ignored), mark all confidences `× 0.8`, banner in the proposal: "Output format may have changed" |
| unrecognizable    | `PARSE_UNSUPPORTED_SHAPE`, artifacts kept, proposal not created, run status `failed`                                                        |

### 4.7 Complete example manifest

Illustrative only; the authoritative Sherlock manifest lives in `13_SHERLOCK.md` §3.

```ts
// packages/integrations/sherlock/manifest.ts
import { zIntegrationManifest, type IntegrationManifest } from '../src/manifest';

export const manifest: IntegrationManifest = zIntegrationManifest.parse({
  manifestVersion: 1,
  id: 'sherlock',
  name: 'Sherlock — username enumeration',
  version: '1.0.0',
  toolVersion: '0.16.0',
  publisher: { name: 'NEXUS core', url: 'https://nexus.local', verified: true },
  icon: 'integrations/sherlock',
  repository: 'https://github.com/sherlock-project/sherlock',
  license: 'MIT',
  description:
    'Checks whether a username exists on 400+ public sites and imports each confirmed hit as a profile node linked to the username.',
  capabilities: ['enumerate-usernames'],
  inputs: [
    {
      name: 'username',
      label: 'Username',
      type: 'string',
      required: true,
      pattern: '^[A-Za-z0-9._-]{1,64}$',
      from: { source: 'selection', kinds: ['username', 'handle'] },
    },
    {
      name: 'sites',
      label: 'Limit to sites',
      type: 'string',
      required: false,
      advanced: true,
      help: 'Comma-separated site names; empty = all sites.',
      from: { source: 'form' },
    },
    {
      name: 'timeoutSec',
      label: 'Per-site timeout',
      type: 'number',
      required: false,
      default: 30,
      min: 5,
      max: 120,
      advanced: true,
      from: { source: 'form' },
    },
    {
      name: 'nsfw',
      label: 'Include NSFW sites',
      type: 'boolean',
      required: false,
      default: false,
      advanced: true,
      from: { source: 'form' },
    },
  ],
  outputs: [
    {
      name: 'result',
      kind: 'json',
      path: '/work/out/result.json',
      primary: true,
      maxBytes: 8 * 1024 * 1024,
    },
    { name: 'console', kind: 'text', fromStdout: true, primary: false, maxBytes: 2 * 1024 * 1024 },
  ],
  permissions: ['graph:read', 'graph:propose', 'net:broad'],
  execution: {
    kind: 'container',
    image: 'sherlock/sherlock',
    digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', // pinned at build; see §6.2
    entrypoint: ['python3', '-m', 'sherlock_project'],
    command: [
      '{{input.username}}',
      '--json',
      '/work/out/result.json',
      '--timeout',
      '{{input.timeoutSec}}',
      '--print-found',
      '--no-color',
    ],
    env: { HOME: '/work', PYTHONUNBUFFERED: '1' },
    secretEnv: {},
    workdir: '/work',
    network: {
      mode: 'broad',
      allow: [],
      denyPrivateRanges: true,
      maxRequestsPerMinute: 900,
      maxConcurrentConnections: 32,
    },
    limits: {
      wallClockMs: 600_000,
      cpuMillicores: 1000,
      memoryMiB: 512,
      pids: 256,
      tmpfsMiB: 256,
      maxOutputBytes: 16 * 1024 * 1024,
      maxArtifacts: 4,
    },
    runtimeClass: 'gvisor',
    user: '65534:65534',
    readOnlyRootFs: true,
  },
  parser: {
    module: '@nexus/integrations/sherlock/parser',
    export: 'parser',
    supportedOutputVersions: ['0.16'],
  },
  entityMappings: [
    {
      id: 'siteHit',
      when: { recordType: 'site_hit' },
      entity: {
        kind: 'url',
        valueFrom: '/url',
        nodeType: 'profile',
        titleFrom: '/site',
        fields: [
          { from: '/site', to: 'service', transform: 'trim', required: true },
          { from: '/status', to: 'status', transform: 'lower' },
          { from: '/http_status', to: 'httpStatus' },
          { from: '/response_time_s', to: 'responseTimeS' },
        ],
        tags: ['sherlock'],
        baseConfidence: 0.75,
      },
      relate: [{ to: 'anchor', edgeType: 'has_profile', direction: 'out', label: 'profile on' }],
    },
  ],
  rateLimits: {
    perUserPerHour: 10,
    perOrgPerHour: 60,
    perTargetPerDay: 3,
    concurrentRunsPerOrg: 2,
    minIntervalMsSameInput: 300_000,
  },
  costHints: {
    typicalDurationMs: 120_000,
    typicalOutboundRequests: 420,
    typicalNewNodes: 12,
    billable: false,
  },
  maturity: 'stable',
  risk: {
    label: 'medium',
    reasons: [
      'Contacts 400+ third-party sites from your egress IP.',
      'False positives are common on sites that return 200 for unknown users.',
    ],
    upstreamMaintenance: 'active',
    fallback:
      'If the image is unavailable, the run fails with TOOL_UNAVAILABLE; no partial import.',
  },
  consent: {
    required: true,
    scopeText:
      'I confirm I am authorized to research this username and that this lookup is lawful in my jurisdiction. Sherlock will send HTTP requests to hundreds of third-party websites from this server.',
    allowedTargetScopes: ['public-index'],
  },
});
```

---

## 5. Run record and database schema

```sql
CREATE TYPE run_status AS ENUM ('queued','awaiting_approval','starting','running','parsing',
                                'succeeded','partial','failed','cancelled','timed_out');

CREATE TABLE integration_runs (
  id               uuid PRIMARY KEY,                 -- uuidv7
  org_id           uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  board_id         uuid NOT NULL,
  integration_id   text NOT NULL,
  adapter_version  text NOT NULL,
  tool_version     text NOT NULL,
  image_digest     text,
  actor_user_id    uuid NOT NULL REFERENCES users(id),
  anchor_node_id   text,
  input            jsonb NOT NULL,                   -- redacted: secretRef fields replaced by name
  input_hash       text NOT NULL,                    -- sha256 of canonical JSON, for re-run dedupe
  targets          jsonb NOT NULL,                   -- ResolvedTarget[]
  consent_id       uuid REFERENCES consents(id),
  status           run_status NOT NULL,
  exit_code        integer,
  error_code       text,
  error_detail     jsonb,
  started_at       timestamptz,
  finished_at      timestamptz,
  duration_ms      integer,
  stats            jsonb NOT NULL DEFAULT '{}',
  artifacts        jsonb NOT NULL DEFAULT '[]',      -- ArtifactRef[]
  proposal_id      uuid REFERENCES import_proposals(id),
  applied_at       timestamptz,
  parent_run_id    uuid REFERENCES integration_runs(id),  -- set for re-runs
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON integration_runs (project_id, created_at DESC);
CREATE INDEX ON integration_runs (integration_id, input_hash, created_at DESC);
CREATE INDEX ON integration_runs (org_id, status) WHERE status IN ('queued','running','parsing');

CREATE TABLE run_log_entries (
  run_id     uuid NOT NULL REFERENCES integration_runs(id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  at         timestamptz NOT NULL,
  level      text NOT NULL CHECK (level IN ('debug','info','warn','error')),
  phase      text NOT NULL,     -- validate|consent|queue|pull|start|exec|egress|collect|parse|map|propose
  message    text NOT NULL,
  data       jsonb,
  PRIMARY KEY (run_id, seq)
);
```

Retention: `run_log_entries` 90 days, artifacts per §6.9, run rows kept for the life of the project
(they are the provenance backbone; deleting them would orphan node provenance).

---

## 6. Runner service

### 6.1 Architecture

```text
API (tRPC runs.start)
  └─ validate input (zod) → legal gate (§12) → rate limit (§12.3) → create run row (queued)
       └─ BullMQ queue "integration.run"  { runId }
             └─ apps/runner  (N replicas, concurrency = 2 per replica by default)
                  1. claim run (Postgres advisory lock on runId) → status starting
                  2. resolve effective limits (manifest ∩ org policy)
                  3. pull image by digest (local cache; fail closed if digest mismatch)
                  4. materialize secrets into a per-run tmpfs dir
                  5. start container (flags §6.3) with egress proxy env
                  6. stream stdout/stderr → ring buffer + S3 multipart + WS progress
                  7. on exit: collect declared output files, size-cap, hash, upload
                  8. status running → parsing; enqueue "integration.parse" { runId }
                  9. cleanup: kill container, unmount tmpfs, revoke proxy token
```

The runner is a separate deployable (`apps/runner`) with its own service account. It has **no**
database write access beyond `integration_runs`, `run_log_entries`, and S3 `runs/` prefix (row-level
grants in `19_DEPLOYMENT.md` §5.2).

### 6.2 Image supply chain

- `execution.digest` is mandatory and is the only thing the runner pulls by. Tag drift is
  impossible.
- Digests are refreshed by a weekly CI job (`.github/workflows/pin-images.yml`) that resolves each
  manifest's `image:toolVersion` tag to a digest and opens a PR. Humans approve; no auto-merge.
- An image not present in the org's allowed registry list (`NEXUS_ALLOWED_REGISTRIES`) is refused
  with `IMAGE_REGISTRY_DENIED`.
- Digest mismatch after pull → `IMAGE_DIGEST_MISMATCH`, run fails, security audit event emitted.

### 6.3 Container flag baseline

Exact flags produced by `apps/runner/src/sandbox/flags.ts` (Docker form; the Kubernetes Pod spec in
`19_DEPLOYMENT.md` §4.3 is the 1:1 equivalent):

```text
docker run --rm
  --runtime=runsc                          # gVisor in production; runc only in dev
  --user 65534:65534
  --read-only
  --tmpfs /work:rw,noexec,nosuid,nodev,size=<tmpfsMiB>m,mode=1777
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m
  --mount type=tmpfs,destination=/run/secrets,tmpfs-size=1m,tmpfs-mode=0400
  --cap-drop ALL
  --security-opt no-new-privileges
  --security-opt seccomp=/etc/nexus/seccomp-tool.json
  --security-opt apparmor=nexus-tool
  --pids-limit <pids>
  --memory <memoryMiB>m --memory-swap <memoryMiB>m
  --cpus <cpuMillicores/1000>
  --ulimit nofile=1024:1024 --ulimit fsize=<maxOutputBytes>
  --network nexus-egress                   # isolated bridge, only the proxy is reachable
  --dns 127.0.0.53 --dns-opt ndots:1       # stub resolver that only answers for the proxy
  --env HTTP_PROXY=http://egress:3128 --env HTTPS_PROXY=http://egress:3128
  --env NO_PROXY=""
  --label nexus.run_id=<runId> --label nexus.org_id=<orgId>
  --stop-timeout 5
  <image>@<digest> <entrypoint...> <command...>
```

Kubernetes production form adds `runtimeClassName: gvisor`,
`securityContext: { runAsNonRoot: true, runAsUser: 65534, allowPrivilegeEscalation: false,
readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] }, seccompProfile: { type: Localhost } }`
and a `NetworkPolicy` that permits egress only to the proxy Service on port 3128.

Notes:

- `noexec` on `/work` prevents a tool from writing and executing a downloaded binary. Tools that
  legitimately need to exec from workdir must declare `execution.workdirExec: true` — **not
  supported in v1**; such tools are rejected at manifest validation.
- `--memory-swap == --memory` disables swap, making OOM deterministic and fast.
- `fsize` ulimit is a second, kernel-level guard for `maxOutputBytes`.

### 6.4 Egress allowlist proxy

Single hardened forward proxy (`infra/egress/`, Squid 6 with a custom `url_rewrite` helper, or the
Go implementation in `apps/runner/src/sandbox/egress-proxy.ts` for self-host simplicity —
**decision: the Go proxy**, because it lets us enforce per-run tokens, per-run rate limits and
DNS pinning in one process without Squid ACL gymnastics).

Behaviour:

1. Container reaches the proxy only; the container network has no default route.
2. Every request must carry `Proxy-Authorization: Bearer <runToken>`; the token is minted per run,
   expires with the run's wall clock, and maps to that run's `EffectiveLimits`.
3. Host check: the request host must match the run's allowlist (`mode: allowlist`) or be any public
   host (`mode: broad`). `mode: none` → the proxy refuses everything (used by offline tools).
4. **DNS pinning (N7):** the proxy resolves the host itself, rejects any answer inside
   `10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7, fe80::/10` plus the cluster CIDR,
   then dials the **resolved IP** with SNI/Host preserved — so DNS rebinding cannot occur.
5. Redirects are not followed by the proxy (it is a forward proxy); the tool follows them, and each
   hop is re-checked. A per-run redirect counter caps total 3xx hops at 20.
6. Rate: token bucket `maxRequestsPerMinute`, burst = 20% of the minute budget; over-limit returns
   `429` with `Retry-After: 1` and increments `stats.egressThrottled`.
7. Every request is logged as `{runId, ts, method, host, path(hash only), status, bytes, decision}`.
   Paths are hashed, not stored, to avoid persisting sensitive query strings; hosts are stored in
   clear because the user needs them in the run log.
8. TLS is **not** intercepted (no MITM). The proxy uses `CONNECT` and enforces the host from the
   CONNECT line + the pinned IP. Consequence: response bodies are not inspectable; body-level
   policy is therefore out of scope, stated here so nobody assumes it exists.

### 6.5 Job protocol

Queue message (BullMQ job data, zod-validated on both ends):

```ts
export const zRunJob = z.object({
  runId: z.string().uuid(),
  orgId: z.string().uuid(),
  attempt: z.number().int().min(1).max(3),
});
```

Everything else (manifest, input, limits) is loaded from Postgres by the runner, so a stale queue
message can never carry stale limits. Job options: `attempts: 1` (we handle retries explicitly —
§11.3 — because blind BullMQ retries would re-scan third-party targets), `removeOnComplete: 1000`,
`removeOnFail: 5000`.

Progress events are published to Redis pub/sub channel `run:<runId>` and fanned out over the
existing WebSocket (`09_BACKEND.md` §6):

```ts
export type RunEvent =
  | { t: 'status'; status: RunStatus; at: string }
  | { t: 'log'; seq: number; level: 'info' | 'warn' | 'error'; phase: string; message: string }
  | { t: 'stdout'; chunk: string } // ≤ 4 KiB, ≤ 20 events/s, coalesced
  | { t: 'metric'; name: 'egress' | 'bytesOut' | 'records'; value: number }
  | { t: 'partial'; entities: number; edges: number } // live result counter
  | { t: 'done'; status: RunStatus; proposalId?: string; error?: IntegrationErrorPayload };
```

Coalescing rule: stdout chunks are flushed at most every 100 ms or 4 KiB, whichever comes first;
the client keeps only the last 2,000 lines in memory and links to the full artifact.

### 6.6 Secret injection

Secrets live in `secrets` (Postgres, encrypted with the KMS-backed data key, `15_SECURITY.md` §6).

Injection rules:

1. Secrets are **never** rendered into `command` argv or `env` values of the manifest. Manifests
   reference them via `secretEnv: { GITHUB_TOKEN: 'github.pat' }` or `{{secretFile.NAME}}`.
2. For `secretEnv`, the runner passes the value through the container create API's env field
   directly — it does not appear in any process command line on the host, and the runner never logs
   the env map (a serializer redacts keys present in `secretEnv`).
3. For `secretFile`, the value is written to `/run/secrets/<name>` on a 1 MiB tmpfs, mode `0400`,
   owner = container UID, mounted read-only; unlinked at run end.
4. `http` execution puts secrets only in `secretHeaders`; the HTTP executor redacts those headers
   in the run log and in any error surface.
5. Output scanning: before an artifact or stdout chunk is persisted, the runner replaces any exact
   occurrence of an injected secret value (length ≥ 8) with `«redacted:NAME»`. This is a
   defence-in-depth measure, not a guarantee — documented as such in `15_SECURITY.md` §6.4.
6. A run may only request secrets whose ACL grants the _project_, not the user, so leaving the org
   does not silently break shared runs.

### 6.7 Timeouts and cancellation

| Timer              | Value                              | Action on expiry                                                                 |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| queue wait         | 15 min                             | run → `failed`, `QUEUE_TIMEOUT`                                                  |
| image pull         | 120 s                              | `IMAGE_PULL_TIMEOUT`, one retry with backoff                                     |
| container start    | 30 s                               | `START_TIMEOUT`                                                                  |
| wall clock         | `limits.wallClockMs`               | SIGTERM → 5 s grace → SIGKILL; status `timed_out`, **partial results collected** |
| no-output watchdog | 180 s without stdout/stderr/egress | warn in log; at 2× → treat as hung, same as wall clock                           |
| parse              | 120 s                              | `PARSE_TIMEOUT`, artifacts kept, no proposal                                     |

User cancellation: `runs.cancel` sets `cancel:<runId>` in Redis (TTL = wall clock) and publishes on
`run:<runId>`. The runner polls the key every 500 ms _and_ subscribes; on trigger it sends SIGTERM,
waits 5 s, SIGKILL, then **still collects whatever the tool wrote** and marks the run `cancelled`
with `partialAvailable: true`. Cancellation from a UI that lost its socket still works because the
key is authoritative.

### 6.8 Partial results and output caps

- Streams are capped independently: stdout and stderr at 2 MiB each (ring buffer keeps the _first_
  1 MiB and the _last_ 1 MiB, with a `«… N bytes elided …»` marker — the head carries the tool's
  banner/version, the tail carries the failure).
- Declared file outputs are capped by `outputs[].maxBytes` and by `limits.maxOutputBytes` for the
  sum. On overflow the file is truncated at the cap, `ArtifactRef.truncated = true`, and the parser
  is told; a truncated JSON artifact is parsed with the streaming parser up to the last complete
  record, and the proposal carries the banner "Output was truncated at N MB; results may be
  incomplete."
- If the process failed but produced a parsable primary output, status is `partial` and a proposal
  **is** created, clearly labelled. Rationale: a Sherlock run that dies at site 380/400 still has
  379 useful results; throwing them away would be worse than importing them with a warning.

### 6.9 Artifact storage and retention

| Item               | Location                                                                          | Retention                               |
| ------------------ | --------------------------------------------------------------------------------- | --------------------------------------- |
| primary output     | `s3://<bucket>/runs/<orgId>/<runId>/<name>.<ext>`                                 | 30 days default, org-configurable 7–365 |
| stdout/stderr      | same prefix, `stdout.txt` / `stderr.txt`                                          | 30 days                                 |
| run log entries    | Postgres                                                                          | 90 days                                 |
| proposal JSON      | Postgres `import_proposals.payload`                                               | 7 days (`expiresAt`), then pruned       |
| provenance snippet | copied **into the node** at apply time (`provenance.pointer` + a ≤ 4 KiB excerpt) | life of the node                        |

The excerpt copy is what makes provenance survive artifact expiry: after 30 days the "View raw"
action shows the stored excerpt and states "Full artifact expired on <date>".
All objects are written with SSE, `Content-Disposition: attachment`, and are served only via
short-lived presigned GETs (5 min) issued after an ACL check.

### 6.10 The run log

The user-inspectable run log is a rendered view of `run_log_entries` plus stream artifacts. It has
exactly these sections and is generated for **every** run, successful or not:

```text
Run 018f…  sherlock 1.0.0  (tool 0.16.0)  image sha256:0000…
Started 14:02:11 by anna@…   Duration 1m 58s   Status Partial

1  Validate      input ok (username="johndoe")                          0 ms
2  Consent       scope "public-index" accepted at 14:02:09              —
3  Queue         waited 1.2 s, runner-3                                 1.2 s
4  Image         cached, digest verified                                0 ms
5  Execute       exit 1 after 1m 54s (wall-clock limit 10m)
   Egress        418 requests to 400 hosts · 2 denied (private range) · 6 throttled
   Output        result.json 412 KB · stdout 84 KB
6  Parse         412 records → 379 site hits, 33 skipped (2 unknown shape)
7  Map           41 entities, 41 relations
8  Propose       12 new nodes, 12 new edges, 4 enriched, 1 conflict, 25 duplicates skipped
```

Every line is expandable. Line 5's "Egress" expands to the host table (host, requests, allowed/
denied, bytes). Line 6's "skipped" expands to the JSON Pointers. "View raw output" and "Download
run log (JSON)" are always available; the JSON bundle is exactly the data used for re-run diffing.

---

## 7. Run lifecycle & UX contract

Full visual specification in `03_UX.md` §18; this section is the behavioural contract.

### 7.1 Entry points

| Entry point                                    | Preconditions                                              |
| ---------------------------------------------- | ---------------------------------------------------------- |
| Node context menu → "Run tool ▸"               | `inputAdapter.accepts(selection)` true for ≥ 1 integration |
| Command palette `Ctrl+K` → "Run <integration>" | integration enabled for org                                |
| Right panel "Integrations" tab                 | always                                                     |
| Re-run from run history                        | original manifest still installed and version-compatible   |

If no integration accepts the selection, the submenu shows the disabled item
"No tool accepts a _<kind>_ node — see all tools" linking to the Integrations panel. Never hide the
affordance silently (principle 1).

### 7.2 The seven states

**1. Configure.** A form generated from `manifest.inputs`. Fields sourced from `selection` are
pre-filled and shown as chips with the source node's title; `advanced: true` fields are collapsed
behind "Advanced (3)". Validation is live, per field, on blur (zod issue → inline message).
Primary button disabled until valid.

**2. Preview cost/scope.** Rendered from `costHints` + `EffectiveLimits` + resolved targets:

```text
This run will
  · contact ~420 third-party hosts (Sherlock's site list)
  · take about 2 minutes (hard limit 10 minutes)
  · typically add ~12 nodes to this board
  · use no paid API credits
Targets: johndoe (username, public-index)
Your remaining quota: 7 of 10 runs this hour
```

**3. Consent (§12.1).** Checkbox with `consent.scopeText`, plus the `risk.reasons` list. The
checkbox state is _not_ remembered across runs for `risk.label = high`; for `low`/`medium` it may
be remembered per project for 24 h with a visible "Consent given <time> — revoke" affordance.

**3a. Approval (conditional).** If `require_approver`, the run enters `awaiting_approval`, the
requester sees "Waiting for a project admin", and admins get an in-app notification with the full
preview payload. Approve/deny is audit-logged.

**4. Running.** A run panel (dockable, non-modal — the user must be able to keep working):
progress phase indicator, elapsed timer with the hard limit, live counters (`egress`, `records`),
last 200 stdout lines behind a disclosure, and a **live results** list that appends entities as the
parse stage streams them (for streaming parsers) or fills at once (for batch parsers). Cancel is
always available and always effective (§6.7). Closing the panel does not cancel; a status pill
remains in the header.

**5. Proposal diff.** Four grouped sections with counts, each item selectable:

| Section         | Row content                                                | Default                             |
| --------------- | ---------------------------------------------------------- | ----------------------------------- |
| New nodes       | type icon, title, key props, confidence bar, "why" tooltip | selected if confidence ≥ 0.6        |
| New edges       | `A —[type]→ B`, both endpoints resolvable                  | selected if both endpoints selected |
| Enriched fields | node title, `field: old → new`                             | selected if old is empty            |
| Conflicts       | node, field, current vs incoming with both provenances     | **unselected**, requires a choice   |

Interactions: select all / none / "only high confidence (≥ 0.8)", per-item checkbox, hover shows the
raw record (`pointer` excerpt), click "Preview on canvas" ghosts the proposed nodes at their
computed positions at 40% opacity without mutating the document. A live footer states
`Applying 14 of 29 items`.

**6. Apply.** Single Y transaction (§3.8). On success: canvas pans to fit the new subgraph
(400 ms ease-out, skipped under `prefers-reduced-motion`), new nodes pulse once, and a toast reads
`Imported 12 nodes and 12 edges from Sherlock` with **Undo** (also `Ctrl+Z`) and **View run**.
Undo restores the exact prior state including enrich patches (`FieldPatch.previous`).

**7. History.** Per board and per project: table of runs (time, integration, actor, target summary,
status, duration, items imported). Row actions: **View run log**, **Re-run** (same inputs, new run,
`parent_run_id` set), **Diff with previous** (§7.6), **Delete artifacts**.

### 7.3 State table for the run surface

| State            | Trigger                                   | Visual                                                                                   | Available actions           |
| ---------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| initial          | panel opened                              | form, primary disabled                                                                   | fill fields                 |
| hover (run item) | pointer over row                          | row bg `--surface-hover`, "why" affordance appears                                       | —                           |
| focus            | keyboard                                  | 2 px `--focus-ring`, scroll into view                                                    | space toggles selection     |
| selected         | checkbox on                               | check mark, accent left border 2 px                                                      | deselect                    |
| loading          | run started                               | phase indicator + elapsed timer + skeleton rows                                          | cancel                      |
| streaming        | first partial event                       | rows append with 120 ms fade; counter increments                                         | cancel, scroll-lock toggle  |
| success          | proposal ready                            | diff view with counts                                                                    | select, apply, discard      |
| partial          | status=partial                            | amber banner "Run ended early — 379 of ~400 checks completed"                            | apply anyway, re-run        |
| error            | status=failed                             | error card: what/why/what to do (§11)                                                    | retry, view log, report     |
| empty            | 0 items                                   | "Sherlock found no accounts for **johndoe**." + "Try another username" + link to run log | re-run with different input |
| conflict-blocked | user hits Apply with unresolved conflicts | conflicts section auto-expands, first unresolved focused                                 | resolve                     |
| undo             | after apply                               | toast 10 s with countdown ring                                                           | undo                        |
| expired          | proposal older than 7 days                | "This proposal expired. Re-run to get fresh results."                                    | re-run                      |

### 7.4 Progress semantics

Tools rarely report real progress. The runner therefore reports **phase** (queued → starting →
running → parsing → done) plus _observable_ counters, and never shows a fake percentage. Exception:
if a parser can compute `processed/total` (SpiderFoot reports module counts), it emits
`{ t: 'metric', name: 'records', value }` and the UI shows a determinate bar. Rationale: a lying
progress bar is worse than an honest spinner with counters.

### 7.5 Re-run rules

- Re-run copies `input` and `consent` context but re-checks quota and consent freshness.
- `minIntervalMsSameInput` blocks a re-run of an identical `input_hash` inside the window with the
  message "Sherlock ran with these exact inputs 2 minutes ago. Wait 3 minutes or change an input."
  and a **View previous result** button. Admins can override with an audit-logged reason.

### 7.6 Diff with previous

Given runs `A` (older) and `B`, both parsed to `ExtractionResult`, the diff is computed on
`identityKey` sets:

```text
added    = keys(B) \ keys(A)
removed  = keys(A) \ keys(B)          // "no longer observed" — never auto-deletes nodes
changed  = keys(A) ∩ keys(B) where propsHash differs   → per-field old/new
```

The UI shows three columns with counts. `removed` items offer, per item, "Mark as not observed on
<date>" which appends to the node's provenance timeline (`06_NODE_SYSTEM.md` §8) — deletion is
never proposed automatically, because absence of evidence is not evidence of absence.

---

## 8. Entity extraction and resolution

### 8.1 Normalizers (`extract/normalizers.ts`)

Every extracted value passes through `normalize(kind, raw)` before it becomes an identity. Rules
are exhaustive and unit-tested against the corpus in `packages/integrations/src/extract/__fixtures__/`.

| Kind       | Normalization                                                                                                                                                                                                                                      | Rejected when                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `domain`   | lowercase; strip trailing `.`; IDN → punycode via `url.domainToASCII`; strip leading `www.` **only for the identity key**, keep original in `display`; validate against the public-suffix list (bundled `psl`, refreshed quarterly)                | not a valid registrable name, or is a bare public suffix (`co.uk`)                                                  |
| `url`      | WHATWG `new URL()`; lowercase scheme+host; drop default port; drop fragment; sort query params; strip tracking params (`utm_*`, `fbclid`, `gclid`, `mc_eid`, `igshid`, `ref`, `ref_src`); collapse `//` in path; keep trailing slash only for root | scheme ∉ {http,https}; host resolves to a private range at apply time (N7)                                          |
| `email`    | lowercase whole address (we do not assume local-part case-sensitivity; documented trade-off); strip `+tag` **only** for the identity key when domain ∈ known tag-supporting set (`gmail.com`, `googlemail.com`)                                    | fails `zod.string().email()` or > 254 chars                                                                         |
| `username` | trim; strip leading `@`; **preserve case** in `display`, lowercase in the key                                                                                                                                                                      | length ∉ [1,64] or contains whitespace/control chars                                                                |
| `handle`   | as `username` plus platform qualifier: key = `handle:<platform>:<lower>`                                                                                                                                                                           | platform unknown → downgrade to `username`                                                                          |
| `ip`       | parse v4/v6; compress v6 (`ipaddr.js`); reject non-canonical (`010.1.1.1`)                                                                                                                                                                         | reserved/loopback/link-local unless `manifest.capabilities` includes `scan-domain` and the target is an owned asset |
| `hash`     | lowercase hex; classify by length (32=md5, 40=sha1, 64=sha256, 128=sha512)                                                                                                                                                                         | non-hex or unknown length                                                                                           |
| `phone`    | E.164 via `libphonenumber-js` with the project's default region; store both E.164 and national display                                                                                                                                             | not parseable → keep as `unknown` entity with confidence × 0.5                                                      |
| `repo`     | canonical `host/owner/name`, lowercase host, preserve owner/name case, strip `.git`, strip `/tree/...`                                                                                                                                             | not matching `^[^/]+/[^/]+/[^/]+$` after cleanup                                                                    |

Normalizer signature:

```ts
export interface NormalizeResult {
  ok: boolean;
  value?: string; // canonical
  display?: string; // human form
  meta?: Record<string, unknown>; // e.g. { hashAlgo: 'sha256' }
  reason?: string; // when !ok, used in the skip issue
}
export type Normalizer = (raw: string, ctx: { defaultRegion?: string }) => NormalizeResult;
export const normalizers: Record<EntityKind, Normalizer>;
```

### 8.2 Identity keys

```ts
export function identityKey(kind: EntityKind, canonicalValue: string): string {
  return `${kind}:${canonicalValue}`; // handle adds its platform inside canonicalValue
}
```

Keys are stored on the node as `props.__identityKey` (indexed, `08_DATA_MODEL.md` §4.3:
`CREATE UNIQUE INDEX ON nodes (board_id, identity_key) WHERE identity_key IS NOT NULL`). Manual
nodes get a key too, computed by the same normalizers when the user types a value into a typed
field — that is what makes tool results merge with hand-made nodes.

### 8.3 Dedupe / merge policy

Resolution order for each `ExtractedEntity` against the target board:

```text
1. exact identityKey match on the board            → MERGE (enrich)
2. exact identityKey match in the project, other board → SUGGEST_LINK (offer a reference node)
3. alias match: node.props.aliases contains value  → MERGE
4. fuzzy candidate: same kind AND trigram similarity(title, display) ≥ 0.82
                                                   → CONFLICT item "possible duplicate"
5. otherwise                                       → NEW
```

Merge (`case 1/3`) semantics per field:

| Situation                                                                 | Result                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| existing field empty                                                      | `set` → `EnrichItem`                                 |
| existing == incoming                                                      | no item (counts as `skippedDuplicates`)              |
| existing ≠ incoming, field is `addToSet` type (tags, aliases, urls)       | `addToSet` → `EnrichItem`                            |
| existing ≠ incoming, scalar, incoming confidence ≥ existing + 0.2         | `ConflictItem` default `replace`                     |
| existing ≠ incoming, scalar, otherwise                                    | `ConflictItem` default `keep`                        |
| existing was manually edited by a user (`props.__manual[field] === true`) | `ConflictItem` default `keep`, badge "edited by you" |

Provenance is **never** overwritten on merge: each node carries
`props.__provenance: Provenance[]` (append-only, capped at 50 entries, oldest-collapsed with a
count). The inspector shows the timeline.

Fuzzy matching uses Postgres `pg_trgm` `similarity()` executed server-side when the proposal is
built (the client does not have the whole board's index for large boards); threshold 0.82 chosen
from the fixture corpus (precision 0.94 / recall 0.71 — biased to precision because a false merge is
much worse than a duplicate node).

### 8.4 Confidence model

```text
confidence = clamp01( base × sourceWeight × evidenceFactor × versionFactor )

base           = manifest entityMapping.baseConfidence          (0.5–0.95)
sourceWeight   = 1.00 authoritative API (GitHub API, WHOIS)
                 0.85 tool with explicit positive assertion (Sherlock "claimed")
                 0.70 heuristic extraction (regex over free text)
                 0.55 inference (co-occurrence, correlation)
evidenceFactor = 1.00 single direct observation
                 1.10 corroborated by ≥ 2 distinct tools (capped by clamp)
                 0.80 tool reported ambiguity / status "unknown"
versionFactor  = 1.00 exact tool version match, 0.80 on drift (§4.6)
```

Display buckets: `≥0.85 High`, `0.6–0.84 Medium`, `<0.6 Low`. Buckets, not raw numbers, are shown
on cards; the exact value is in the inspector. Items with `Low` are unselected by default.

Corroboration is computed at apply time: if a node already has provenance from another tool with
the same field value, the stored `confidence` is recomputed as
`1 - Π(1 - cᵢ)` (noisy-OR) capped at 0.97 — no observation chain ever reaches certainty.

### 8.5 Provenance attachment

At apply time the Applier writes, per created/patched node:

```ts
node.props.__provenance.push({
  source,
  tool,
  toolVersion,
  runId,
  observedAt,
  importedAt,
  confidence,
  artifactRef,
  pointer,
  actorUserId,
  excerpt: string, // ≤ 4 KiB slice of the raw record, JSON-stringified
});
```

Edges carry the same object (single entry, since an edge comes from one observation; a repeated
observation appends and bumps confidence by noisy-OR).

N4/N7 compliance check runs in `applyProposal`: any node whose `__provenance` is empty throws
`ProvenanceMissingError` — a programming error, surfaced as an internal error and reported, never
silently accepted.

---

## 9. Rendering integration results on the canvas

- New nodes are inserted with `layoutHint` positions computed **before** the user accepts, so the
  ghost preview and the applied result are identical (no jump).
- Import creates an implicit selection of the new subgraph after apply, so `Ctrl+G` immediately
  groups it.
- Each imported node shows a small tool badge (16×16 icon, bottom-right of the card) and, at
  `zoom ≥ 0.55`, a confidence bar (2 px, width 32 px). Below `0.55` the badge collapses into the LOD
  glyph color per `05_CANVAS_ENGINE.md` §6.2.
- Imports never move or resize existing nodes. If the radial placement would overlap an existing
  node, the placer spirals outward (step 40 px, up to 60 attempts) and, failing that, drops the
  node into a "Imported <date>" staging column to the right of the board bounds.

---

## 10. Public REST surface (for plugins/webhooks)

Defined in OpenAPI (`apps/api/openapi/integrations.yaml`); tRPC mirrors it for the web client.

| Method | Path                                       | Purpose                                                                                                                     |
| ------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/integrations`                         | list installed manifests (redacted: no digests for non-admins)                                                              |
| POST   | `/v1/runs`                                 | start a run `{integrationId, boardId, input, anchorNodeId?, consentToken}`                                                  |
| GET    | `/v1/runs/:id`                             | run record incl. status and stats                                                                                           |
| GET    | `/v1/runs/:id/log`                         | run log JSON                                                                                                                |
| GET    | `/v1/runs/:id/artifacts/:name`             | 302 to a 5-minute presigned URL                                                                                             |
| POST   | `/v1/runs/:id/cancel`                      | cancel                                                                                                                      |
| GET    | `/v1/proposals/:id`                        | proposal payload                                                                                                            |
| POST   | `/v1/proposals/:id/apply`                  | server-side apply (used by headless clients; goes through the same Applier running in `apps/sync` against the room's Y.Doc) |
| GET    | `/v1/runs?boardId=&integrationId=&status=` | history, cursor-paginated                                                                                                   |

All endpoints require a scoped API token (`15_SECURITY.md` §3.4); `POST /v1/runs` additionally
requires a `consentToken` obtained from `POST /v1/consents`, so headless clients cannot bypass §12.

---

## 11. Error taxonomy

### 11.1 Codes

```ts
export type IntegrationErrorCode =
  // input / config
  | 'INPUT_INVALID'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_TEMPLATE_UNRESOLVED'
  | 'INTEGRATION_DISABLED'
  | 'PERMISSION_DENIED'
  | 'CONSENT_REQUIRED'
  | 'TARGET_NOT_ALLOWED'
  // capacity / policy
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'CONCURRENCY_LIMIT'
  | 'QUEUE_TIMEOUT'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_DENIED'
  // execution
  | 'IMAGE_PULL_TIMEOUT'
  | 'IMAGE_DIGEST_MISMATCH'
  | 'IMAGE_REGISTRY_DENIED'
  | 'START_TIMEOUT'
  | 'TOOL_UNAVAILABLE'
  | 'TOOL_EXIT_NONZERO'
  | 'TIMEOUT'
  | 'OOM_KILLED'
  | 'CANCELLED'
  | 'SANDBOX_VIOLATION'
  // network
  | 'EGRESS_DENIED'
  | 'EGRESS_THROTTLED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_AUTH_FAILED'
  | 'UPSTREAM_RATE_LIMITED'
  // output
  | 'OUTPUT_MISSING'
  | 'OUTPUT_TOO_LARGE'
  | 'PARSE_TIMEOUT'
  | 'PARSE_UNSUPPORTED_SHAPE'
  | 'PARSE_EMPTY'
  // apply
  | 'PROPOSAL_EXPIRED'
  | 'TARGET_MISSING'
  | 'APPLY_CONFLICT'
  | 'PROVENANCE_MISSING'
  // catch-all
  | 'INTERNAL';

export interface IntegrationErrorPayload {
  code: IntegrationErrorCode;
  what: string; // what happened, ≤ 90 chars
  why: string; // why, ≤ 140 chars
  action: string; // what to do, ≤ 90 chars, imperative
  retryable: boolean;
  retryAfterMs?: number;
  detail?: Record<string, unknown>; // never contains secrets
  runId?: RunId;
}
```

### 11.2 User-facing copy (canonical strings)

| Code                      | what / why / action                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INPUT_INVALID`           | "That input isn't valid." / "_Username_ may contain letters, digits, dot, dash and underscore only." / "Fix the highlighted field."                                         |
| `CONSENT_REQUIRED`        | "Confirm authorization first." / "This tool contacts third-party services on your behalf." / "Tick the authorization box to continue."                                      |
| `TARGET_NOT_ALLOWED`      | "This target isn't permitted." / "Your organization restricts _SpiderFoot_ to assets you own." / "Add the domain to Verified assets, or ask an admin."                      |
| `QUOTA_EXCEEDED`          | "Hourly limit reached." / "You've used 10 of 10 _Sherlock_ runs this hour." / "Try again at 15:00 or ask an admin to raise the limit."                                      |
| `RATE_LIMITED`            | "Slow down for a moment." / "The same input ran 2 minutes ago; results rarely change that fast." / "Open the previous result, or wait 3 minutes."                           |
| `CONCURRENCY_LIMIT`       | "Too many runs at once." / "Your organization allows 3 concurrent runs; 3 are active." / "Wait for a run to finish, or cancel one."                                         |
| `APPROVAL_REQUIRED`       | "Waiting for approval." / "A project admin must approve runs of _SpiderFoot_." / "We've notified your admins — you'll get a notification."                                  |
| `IMAGE_DIGEST_MISMATCH`   | "Tool image failed verification." / "The downloaded image doesn't match the pinned digest." / "Contact your administrator — do not retry."                                  |
| `TOOL_UNAVAILABLE`        | "The tool couldn't start." / "The container image isn't available on this server." / "Ask an admin to pull the image, then retry."                                          |
| `TOOL_EXIT_NONZERO`       | "The tool stopped with an error." / "_Sherlock_ exited with code 2." / "Open the run log to see the tool's own message."                                                    |
| `TIMEOUT`                 | "The run hit its time limit." / "It ran for 10 minutes, the maximum for this tool." / "Narrow the input, or import the partial results."                                    |
| `OOM_KILLED`              | "The run ran out of memory." / "It exceeded the 512 MB limit for this tool." / "Reduce the scope, or ask an admin to raise the limit."                                      |
| `EGRESS_DENIED`           | "A network request was blocked." / "The tool tried to reach a private address, which is never allowed." / "Import what was collected, or report the tool."                  |
| `UPSTREAM_AUTH_FAILED`    | "The service rejected our credentials." / "The stored token for _GitHub_ is invalid or expired." / "Update the token in Settings → Secrets."                                |
| `UPSTREAM_RATE_LIMITED`   | "The service asked us to wait." / "_GitHub_ rate limit reached; it resets in 12 minutes." / "We'll retry automatically — or run again later."                               |
| `OUTPUT_MISSING`          | "The tool produced no output file." / "It exited successfully but wrote nothing to result.json." / "Open the run log; this usually means no matches."                       |
| `OUTPUT_TOO_LARGE`        | "Output was too large." / "The tool wrote more than 64 MB; we kept the first 64 MB." / "Import the partial results, or narrow the scope."                                   |
| `PARSE_UNSUPPORTED_SHAPE` | "We couldn't read the tool's output." / "The format doesn't match adapter version 1.0.0 (tool 0.16.0)." / "Download the raw output and report this — no data was imported." |
| `PARSE_EMPTY`             | "No results found." / "_Sherlock_ checked 400 sites and found no accounts for _johndoe_." / "Try a different spelling, or another tool."                                    |
| `PROPOSAL_EXPIRED`        | "This result set expired." / "Proposals are kept for 7 days so imports reflect current data." / "Re-run the tool."                                                          |
| `TARGET_MISSING`          | "Some items couldn't be applied." / "3 nodes they referenced were deleted while you reviewed." / "Re-run to get a fresh proposal."                                          |
| `SANDBOX_VIOLATION`       | "The run was stopped for safety." / "The tool attempted an operation the sandbox forbids." / "Report this integration to your administrator."                               |
| `INTERNAL`                | "Something went wrong on our side." / "The run failed before it produced results (ref `<runId>`)." / "Retry; if it persists, send us the run reference."                    |

Copy rules: no stack traces, no error numbers in the primary line, tool names in _italics_, always
exactly three sentences (what / why / action) per `00_MASTER.md` §10.5 and `03_UX.md` §12.

### 11.3 Retry policy

| Code                                                                       | Retry       | Strategy                                                                                   |
| -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `QUEUE_TIMEOUT`, `START_TIMEOUT`, `IMAGE_PULL_TIMEOUT`, `INTERNAL`         | automatic   | ≤ 2 attempts, backoff 5 s → 30 s, jitter ±20%                                              |
| `UPSTREAM_RATE_LIMITED`                                                    | automatic   | honor `Retry-After`; if > 15 min, park the run as `failed` with a "Run again later" action |
| `UPSTREAM_UNAVAILABLE` (5xx)                                               | automatic   | 3 attempts, 2 s → 8 s → 32 s                                                               |
| `TOOL_EXIT_NONZERO`, `TIMEOUT`, `OOM_KILLED`, `PARSE_*`                    | manual only | automatic retry would re-hit third parties for the same failure                            |
| `EGRESS_DENIED`, `SANDBOX_VIOLATION`, `IMAGE_DIGEST_MISMATCH`              | never       | security-relevant; requires human review                                                   |
| `QUOTA_EXCEEDED`, `RATE_LIMITED`, `CONSENT_REQUIRED`, `TARGET_NOT_ALLOWED` | never       | user must act                                                                              |

Automatic retries reuse the same `run.id`, increment `attempt`, and append to the run log — they do
not create new run rows, so history stays clean.

### 11.4 Degraded modes

| Condition                                                          | Degraded behaviour                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner service down                                                | runs stay `queued`, UI shows "Tool runner is offline — runs will start automatically when it returns"; queue drains on recovery; after 15 min the run fails with `QUEUE_TIMEOUT`                  |
| S3 unavailable                                                     | run proceeds, artifacts buffered to the runner's local tmpfs up to 32 MiB; if upload still fails, run is `partial` with `artifactsUnavailable: true` and the parse runs from the in-memory buffer |
| Postgres read-only (failover)                                      | new runs rejected with `INTERNAL` + "maintenance"; running runs complete and their results are held in Redis for 10 min for a late write                                                          |
| Parser worker backlog > 200                                        | proposals delayed; UI shows "Parsing queued (position 14)"                                                                                                                                        |
| Upstream tool unmaintained (SpiderFoot, §12 of `12_SPIDERFOOT.md`) | integration keeps working on its pinned digest; the Integrations panel shows a "Low upstream maintenance" badge with the fallback path                                                            |

---

## 12. Legal / ethical gate

`00_MASTER.md` §3.6 requires legality by design. This is the enforcement mechanism; policy text
lives in `15_SECURITY.md` §9.

### 12.1 Consent

- Every manifest with `consent.required` (all non-`builtin` ones) forces an explicit checkbox per
  run, showing `consent.scopeText` verbatim plus `risk.reasons`.
- Accepting creates a `consents` row:

```sql
CREATE TABLE consents (
  id             uuid PRIMARY KEY,
  org_id         uuid NOT NULL,
  project_id     uuid NOT NULL,
  user_id        uuid NOT NULL,
  integration_id text NOT NULL,
  scope          text NOT NULL,        -- target scope
  targets_hash   text NOT NULL,        -- sha256 of sorted normalized targets
  scope_text_hash text NOT NULL,       -- so we can prove which wording was shown
  accepted_at    timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  ip             inet, user_agent text
);
```

- Validity: `risk.label = high` → single run only; `medium` → 24 h, same project + same target set;
  `low` → 7 days, same project. Any change of target set invalidates.
- A consent can be revoked from Settings → Privacy; revocation cancels queued runs relying on it.

### 12.2 Allowed-target policy

Each `ResolvedTarget` gets a scope:

| Scope              | Definition                                                                                                     | Default policy                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `owned-asset`      | domain/IP verified by the org via DNS TXT `nexus-verify=<token>` or an uploaded authorization letter reference | always allowed                                                                                                                          |
| `public-index`     | lookups against public indexes about an identifier (username on public sites, WHOIS, public repos)             | allowed                                                                                                                                 |
| `third-party-host` | direct requests to infrastructure the org does not own (port/vuln-style scanning)                              | **blocked by default**; an org admin must enable it per project and record an engagement reference (free-text, stored in the audit log) |

Enforcement point: `assertTargetsAllowed(manifest, targets, orgPolicy)` runs in the API before the
run row is created **and** again in the runner before the container starts (defence in depth). A
mismatch in the runner is a `SANDBOX_VIOLATION`-class audit event.

Hard denylist, non-overridable: any target resolving into private/reserved ranges (unless
`owned-asset` and explicitly whitelisted by an admin), `.gov`/`.mil` hosts for scanning-class
capabilities, and any host on the operator-maintained `infra/policy/never-scan.txt`.

### 12.3 Rate limiting (abuse prevention)

Four independent token buckets, all in Redis, all checked before enqueue:

```text
user:<userId>:<integrationId>      → manifest.rateLimits.perUserPerHour        (window 1h, sliding)
org:<orgId>:<integrationId>        → perOrgPerHour                             (window 1h, sliding)
target:<orgId>:<sha256(target)>    → perTargetPerDay                           (window 24h)
concurrency:<orgId>                → concurrentRunsPerOrg                      (semaphore, TTL = max wall clock)
```

Plus the global egress rate cap enforced in the proxy (§6.4). `perTargetPerDay` is the key
anti-abuse control: it makes NEXUS unusable as a mass-scanning engine even by a legitimate account.
Buckets are also written to metrics (`nexus_integration_ratelimit_hits_total{code,integration}`) and
alert at > 50 hits/hour for one org (`19_DEPLOYMENT.md` §8).

### 12.4 Audit logging

Every run emits immutable audit events (append-only `audit_events`, `15_SECURITY.md` §7):

| Event                                  | Payload                                         |
| -------------------------------------- | ----------------------------------------------- |
| `integration.run.requested`            | actor, integration, input hash, targets, scopes |
| `integration.consent.accepted`         | consent id, scope text hash                     |
| `integration.run.approved` / `.denied` | approver, reason                                |
| `integration.run.started`              | runner id, image digest, effective limits       |
| `integration.egress.denied`            | host, reason                                    |
| `integration.run.finished`             | status, duration, counters                      |
| `integration.proposal.applied`         | proposal id, item counts, created node ids      |
| `integration.proposal.discarded`       | proposal id                                     |
| `integration.policy.overridden`        | admin, what was overridden, reason text         |

Audit events are exportable as CSV/JSON per project — this is what makes an investigation
defensible (`15_SECURITY.md` §7.3).

---

## 13. Testing requirements (summarized; full strategy in `18_TESTING.md`)

1. **Manifest conformance test** — every manifest in `packages/integrations/*` parses, has exactly
   one primary output, a pinned digest, `consent.scopeText` ≥ 20 chars, and every
   `entityMappings[].entity.nodeType` exists in the node registry.
2. **Parser golden tests** — each parser has ≥ 3 fixtures (happy, truncated, malformed) with
   snapshot `ParsedDocument`s; fixtures are committed raw tool output, never hand-written.
3. **Pipeline property test** — for random `ParsedDocument`s, `extract → map → propose → apply →
undo` returns the document to a deep-equal prior state (N3, N9).
4. **Sandbox tests** (`e2e/runner/`) — a purpose-built `nexus/test-hostile` image asserts: write to
   `/` fails, exec from `/work` fails, connect to `169.254.169.254` fails, fork bomb hits the pid
   cap, 1 GiB allocation is OOM-killed, 10 GiB stdout is capped, secrets do not appear in `ps`.
5. **Egress proxy tests** — DNS rebinding corpus (hostile URL corpus shared with N7 tests).
6. **UX e2e** — configure → preview → consent → run (mocked runner) → diff → partial apply → undo,
   plus the empty, error and expired states.
7. **Load** — k6 scenario: 50 concurrent runs, assert queue latency p95 < 5 s and no limit leakage.

---

## 14. Extension and enforcement notes

1. Adding a tool touches exactly: `packages/integrations/<id>/{manifest.ts,parser.ts,fixtures/}`,
   one line in `packages/integrations/src/index.ts`, an icon in `packages/ui`, and a spec doc.
2. A tool that cannot be expressed by the manifest must extend the _manifest_, not the core — new
   fields are additive with defaults, `manifestVersion` bumps only on a breaking change (v1 → v2
   requires a migration function `migrateManifest(v1) → v2` shipped in the same PR).
3. Custom stage implementations (`InputAdapter`, `EntityExtractor`, …) are allowed only for
   first-party integrations; third-party plugins get the declarative path only
   (`17_PLUGIN_SDK.md` §5).
4. Lint rules: `no-direct-graph-write` (writes outside `applyProposal`), `no-tool-names-in-core`
   (identifiers `github|sherlock|spiderfoot` outside `packages/integrations`),
   `no-child-process-in-api`.

---

## Open risks

1. **Upstream tool drift.** Sherlock ships frequently and SpiderFoot shows low activity (0 commits
   in 90 days per deps.dev, June 2026). Both risks are handled by digest pinning + tolerant parsing
   (§4.6), but a silent _semantic_ change (a site check becoming unreliable rather than the format
   changing) would degrade result quality without any signal. Mitigation to build in P12: a weekly
   canary run against a known fixture target with an alert on result-count drift > 30%.
2. **False-positive imports.** Username enumeration is inherently noisy; the confidence model and
   the "Low is unselected by default" rule reduce, but do not remove, the risk that an analyst
   imports a wrong identity. Accepted, mitigated by mandatory provenance and the confidence bucket
   on every card.
3. **Egress proxy as a single point of failure and of trust.** All tool traffic funnels through one
   process. Its compromise means arbitrary egress. Mitigated by running it as a separate, minimal,
   non-root service with its own NetworkPolicy; not eliminated.
4. **No TLS inspection** (§6.4 point 8) means we cannot detect data exfiltration inside an encrypted
   tool connection. Deliberate: MITM of third-party TLS would be a worse security and legal
   position. Residual risk accepted and documented for self-hosters.
5. **Fuzzy dedupe threshold (0.82)** is tuned on a synthetic corpus. Real boards may need per-org
   tuning; if precision complaints appear, expose it as an org setting rather than changing the
   default silently.
6. **Partial-result semantics** may mislead: a `partial` Sherlock run that stopped at site 380
   looks like "no account on the remaining 20 sites". The proposal banner states the truth, but the
   node-level data does not encode "not checked". Follow-up (P16): record `coverage` on the run and
   surface it in the node inspector.
7. **gVisor performance** on syscall-heavy Python tools can cost 20–40% wall clock. Budgets in
   `costHints` assume gVisor; if a self-hoster uses `runc`, the estimates over-predict. Acceptable.
8. **Proposal expiry at 7 days** may frustrate long investigations that pause. Chosen over infinite
   retention because applying stale results silently is worse; revisit with usage data.
