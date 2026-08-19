# Raven — 21 — TRANSFORM SYSTEM

## Scope

The analyst-facing operation layer: **transforms**, the **capability router** that picks engines
for them, the **provider registry**, execution **modes** and **budgets**, the **expand planner**,
and the contracts for results, provenance, caching and history.

This document implements `prompts/PROMPT_4_MALTEGO_ECOSYSTEM_RU.md` (Layer 4) on top of the
existing integration framework. It **does not** replace `10_INTEGRATIONS.md`: that document owns
execution (Runner, sandbox, egress, artifacts), parsing, entity extraction/resolution and the
`ImportProposal` write path. Layer 4 sits above it and answers a different question — _which_
operation to run, with which engine, under which permissions and budget.

Ships in phases **L4.1–L4.7** (`20_ROADMAP.md`). The ecosystem research behind it is
`docs/ecosystem/MALTEGO_AUDIT.md`, `PROVIDER_CATALOG.md` and `TRANSFORM_CATALOG.md`.

---

## 1. Vocabulary (frozen)

| Term           | Definition                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| **Capability** | What can be learned, independent of how: `dns-discovery`, `profile-discovery`. A stable string id.          |
| **Transform**  | The analyst-facing operation: "Discover DNS records". Declares input/output kinds and one capability.       |
| **Engine**     | An implementation of a capability: `doh-resolver`, `sherlock`. Wraps an integration from `10_INTEGRATIONS`. |
| **Provider**   | The external or local source an engine talks to, with credentials, limits and licence.                      |
| **Plan**       | A DAG of transform invocations with budgets, produced by the planner and approved by the user.              |
| **Run**        | One execution of one transform over one input set. Has a lifecycle, a log and a result set.                 |

Rule **T1**: a transform never names a provider. It names a capability. Only engines name
providers. This is what lets a provider be replaced without touching a saved graph (brief §46).

Rule **T2**: no layer above the router may choose an engine by hand. The UI offers intents; the
router resolves. An explicit engine override exists for debugging only and is recorded in the run.

---

## 2. Package layout

```text
packages/transforms/
├─ src/
│  ├─ types.ts          frozen types: manifests, plans, availability, results
│  ├─ manifest.ts       zod schemas + parse helpers for transform/engine/provider manifests
│  ├─ registry.ts       createTransformRegistry / createProviderRegistry, indices, validation
│  ├─ modes.ts          execution modes and availability resolution
│  ├─ router.ts         capability → engine chain (selection, fallbacks, scoring)
│  ├─ score.ts          transform and engine quality scores
│  ├─ planner.ts        contextual menu, expand plan, DAG layers, budget accounting
│  ├─ catalog/
│  │  ├─ providers.ts   the seeded provider registry (mirrors PROVIDER_CATALOG.md)
│  │  ├─ engines.ts     the seeded engine registry
│  │  └─ transforms.ts  the seeded transform registry (mirrors TRANSFORM_CATALOG.md)
│  └─ index.ts
└─ test/
```

`packages/transforms` depends only on `packages/domain` and `packages/config` — it is pure logic
with no I/O, so the planner and router are fully testable in Node. Execution lives in
`apps/runner`; the SDK surface for third parties lives in `17_PLUGIN_SDK.md`.

---

## 3. Manifests

### 3.1 Transform manifest

```ts
interface TransformManifest {
  readonly id: string; // kebab-case, stable, e.g. "domain-to-dns"
  readonly version: string; // semver of the manifest
  readonly name: string; // "Discover DNS records"
  readonly description: string;
  readonly category: TransformCategory; // identity | infrastructure | web | files | repositories | records | analysis
  readonly capability: CapabilityId;
  readonly inputs: readonly EntityKind[]; // at least one
  readonly outputs: readonly EntityKind[];
  readonly engines: readonly EngineId[]; // preference order; the router may reorder by score
  readonly priority: TransformPriority; // core | recommended | optional | experimental | external | deprecated
  readonly cost: ExecutionClass; // fast | standard | deep | optional
  readonly limits: {
    readonly expectedRuntimeMs: number;
    readonly maxResults: number;
    readonly maxInputBatch: number; // how many selected nodes one run accepts
  };
  readonly cacheable: boolean;
  readonly cacheTtlSeconds?: number; // required when cacheable
  readonly documentation: string; // path or URL
  readonly status: 'stable' | 'beta' | 'unavailable' | 'deprecated';
}
```

### 3.2 Engine manifest

```ts
interface EngineManifest {
  readonly id: EngineId;
  readonly version: string;
  readonly capability: CapabilityId;
  readonly provider: ProviderId;
  readonly integration?: string; // integration id from 10_INTEGRATIONS.md, when it runs in the Runner
  readonly dataFlow: 'local' | 'network' | 'external-api';
  readonly permissions: readonly Permission[]; // network | filesystem | subprocess | credentials | browser
  readonly quality: QualitySignals; // see §6
  readonly cost: ExecutionClass;
  readonly status: 'stable' | 'beta' | 'unavailable' | 'deprecated';
}
```

### 3.3 Provider manifest

```ts
interface ProviderManifest {
  readonly id: ProviderId;
  readonly name: string;
  readonly credentialClass: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  readonly credentials: 'none' | 'optional' | 'required';
  readonly pricing: 'free' | 'free-tier' | 'paid' | 'local';
  readonly endpoint?: string;
  readonly licence: string; // of the engine/tool
  readonly dataLicence?: string; // of the returned data, e.g. "ODbL" — travels with exports
  readonly limits: {
    readonly requestsPerMinute?: number;
    readonly requestsPerDay?: number;
    readonly note?: string;
  };
  readonly attribution?: string; // required attribution text, rendered on export
  readonly lastVerified: string; // ISO date; the health check flags entries older than 180 days
  readonly status: ProviderStatus; // configured | not-configured | invalid | rate-limited | disabled | unavailable | deprecated
  readonly alternatives: readonly ProviderId[];
}
```

`credentialClass` and `pricing` are separate on purpose (brief §90): a class-C provider is free to
_start_ using and still runs out. Nothing in the UI may collapse them into one "free" badge.

### 3.4 Licence propagation

`dataLicence` and `attribution` are copied onto every entity a run produces, and the export path
(`packages/domain/src/export`) renders the union of attributions. A licence that requires
share-alike (ODbL) marks the export accordingly. Losing attribution on export is a bug, not a
cosmetic issue.

---

## 4. Registries

```ts
const registry = createTransformRegistry({ transforms, engines, providers });

registry.transform(id); // TransformManifest | undefined
registry.forInput(kind); // transforms whose inputs include kind
registry.forCapability(capability); // transforms + engines
registry.enginesFor(capability); // EngineManifest[], preference order
registry.provider(id); // ProviderManifest | undefined
registry.validate(); // ManifestIssue[] — empty on a healthy registry
```

`validate()` is the contract test in disguise: it fails when a transform names a missing engine,
an engine names a missing provider, a cacheable transform has no TTL, a `core` transform has no
engine reachable in Zero-Credential Mode, or a capability has no fallback ending in `manual` /
`external`. The seeded catalogue must pass with zero issues at build time.

---

## 5. Capability router

```text
intent (transform id + input entities + mode + budget)
      │
      ▼  engines for capability
  filter by mode        (§7)
      │
      ▼  filter by provider status and permissions
  score and order       (§6)
      │
      ▼
  chain: [primary, …fallbacks, terminal]
```

The chain is materialised **before** execution and shown in Preview (brief §9). Fallback happens
on: provider `unavailable` / `rate-limited` / `invalid`, engine health-check failure, timeout, or
an empty result _only if_ the engine reports `exhaustive: false`.

Terminal steps are never errors:

```text
Primary engine → free alternative → local alternative → external source → manual
```

`Run Compatible` (brief §11) resolves _all_ engines whose capabilities are not already covered by a
higher-scoring engine in the plan — deduplicated by capability, filtered by availability, budget
and permissions. It is not "run everything".

---

## 6. Scores

Two scores, both pure functions of the manifests plus live provider status, both explainable in
the UI (every score exposes its component breakdown — an unexplainable ranking is a black box the
analyst cannot audit).

```
engineScore   = 0.30·quality.resultQuality
              + 0.20·quality.reliability
              + 0.15·privacy(dataFlow)        // local 1.0, network 0.6, external-api 0.3
              + 0.15·availability(status)     // configured 1.0 … unavailable 0
              + 0.10·speed(cost)              // fast 1.0, standard 0.7, deep 0.3, optional 0.5
              + 0.10·quality.maintenance
```

`transformScore` is the max engine score among currently usable engines, multiplied by a priority
weight (`core` 1.0, `recommended` 0.9, `optional` 0.7, `experimental` 0.5, `external` 0.3,
`deprecated` 0). It orders the contextual menu and the library, nothing else — it never silently
hides a transform the analyst asked for by name.

---

## 7. Execution modes

| Mode               | Allowed                                                  | Blocked                                 |
| ------------------ | -------------------------------------------------------- | --------------------------------------- |
| `strict-local`     | `dataFlow: 'local'` engines only                         | every network call, remote AI included  |
| `zero-credential`  | local + providers with `credentials: 'none'`             | anything needing a key, even a free one |
| `free-tier`        | the above + `pricing: 'free' \| 'free-tier'` with a key  | paid providers                          |
| `configured`       | the above + paid providers that are actually configured  | unconfigured providers                  |
| `maximum-coverage` | everything usable, after an explicit confirmation dialog | class E/F providers (never executable)  |

The mode is a **workspace setting** with a per-run override. `strict-local` is the default when
`APP_MODE=local` (`packages/config/src/appMode.ts`) — local-first means local by default, and any
outbound call requires an explicit choice. Mode filtering happens in the router, never in the UI:
a blocked engine must be impossible to reach, not merely hidden.

When every engine of a transform is filtered out, the transform stays visible with a reason —
`requires-configuration`, `blocked-by-mode`, `provider-unavailable`, `paid-only` — plus the offered
alternatives (brief §44). Never an error toast.

---

## 8. Planner

### 8.1 Contextual menu

`planner.actionsFor(entities, ctx)` returns at most **7** transforms, ordered by transform score,
covering distinct capabilities, plus a "More…" entry into the library. Ranking inputs: entity kind,
what already exists on the canvas around the node (avoid re-running a transform whose results are
already there), mode, and provider status.

### 8.2 Expand

`planner.expand(entity, { hops, budget, mode })` builds the plan behind the single **Expand**
button (brief §57, §105):

- `hops: 1` — transforms directly applicable to the entity.
- `hops: 2` — plus transforms applicable to the _predicted_ output kinds, as a second DAG layer.
- `deep` — bounded by budget only; requires confirmation.

The plan is returned before anything runs:

```ts
interface TransformPlan {
  readonly steps: readonly PlanStep[]; // topologically ordered
  readonly estimate: {
    readonly runtimeMs: number;
    readonly minEntities: number;
    readonly maxEntities: number;
  };
  readonly requiresNetwork: boolean;
  readonly providersUsed: readonly ProviderId[];
  readonly credentialsNeeded: readonly ProviderId[];
  readonly excluded: readonly { readonly transform: string; readonly reason: ExclusionReason }[];
}
```

`excluded` is mandatory: the preview must state what was left out and why, so the analyst is never
silently limited (the failure mode of Maltego's credit truncation, `MALTEGO_AUDIT.md` §3).

### 8.3 DAG

Independent steps run in parallel up to `budget.maxParallel`; dependent steps wait for their
producer. Layer 1 consumes the selected entity, layer 2 consumes layer 1's predicted output kinds, and a
transform is planned at most once — so the plan is a DAG by construction and `steps` is already in
topological order. A step whose producer yielded nothing is skipped at run time.

### 8.4 Agent planning

The research agent (`14_AI_AGENT.md`) may call `planner.expand` and chain plans, but the same
budget object bounds it — iterations, transforms, runtime, results, depth — and the plan still goes
through user approval unless the workspace enabled autonomous mode for that budget class. There is
no unbounded agent (brief §36).

---

## 9. Results

### 9.1 Lifecycle

```text
queued → running (progress, partial results) → completed | partial | failed | cancelled
```

Cancellation is cooperative and **keeps partial results** (brief §82–83): a run stopped at 70 %
yields the 70 %, marked `partial`. A failed run records `reason`, `engine`, `provider`, whether a
retry is meaningful and which alternative to try.

### 9.2 Applying to the graph

Results never enter the graph directly. They become an `ImportProposal`
(`10_INTEGRATIONS.md` §3) offered as **Add all / Add selected / Preview / Ignore / Create cluster**.
Above `CLUSTER_THRESHOLD` (default 25) entities the default is **Create cluster**: one node
("Sherlock results — 47 findings") that expands on demand, so a broad transform cannot wreck the
canvas.

### 9.3 Deduplication and source multiplicity

Two engines returning the same entity produce **one** node with `sources: [engineA, engineB]` and
a merged evidence list (brief §61–62). Identity keys come from `10_INTEGRATIONS.md` §8.2 — Layer 4
adds no second identity model. Confidence rises with independent corroboration; it is a stored
number, never recomputed on render.

### 9.4 Traceability

Every generated entity answers "how was this discovered?" with the full chain: input entity →
transform → engine → provider → raw artifact pointer → observation time. The chain is data, not a
log line, and survives export.

---

## 10. History, replay, comparison, cache

- **History**: every run stores transform, version, input, engine, provider, mode, timestamps,
  result count, errors and duration.
- **Replay**: re-run with today's engines and today's provider status; the original run is kept.
- **Compare**: two runs of the same transform diff into added / removed / changed / new evidence.
- **Cache key**: `transform.id + transform.version + engine.id + engine.version + provider.id + normalized input`.
  TTL from the manifest, and only when the provider's terms allow storing results. A cache hit is
  labelled in the UI with the age of the data — a stale answer presented as fresh is a correctness
  bug in an investigation tool.

---

## 11. Universal query and the library

The query bar accepts a raw selector (`example.com`, `@handle`, an IP) and resolves it to an entity
kind, then offers the ranked transforms for that kind — "search" is the contextual menu with an
entity that does not exist on the canvas yet. The Transform Library is the same registry browsed by
category with filters for credential class, mode compatibility, priority and provider status.

---

## 12. Security

Everything in `15_SECURITY.md` applies unchanged, plus:

1. **Permission declaration**: an engine gets only the permissions in its manifest. Requesting more
   at run time fails the run.
2. **Sandbox**: third-party engines execute in the Runner sandbox with allowlisted egress. No
   plugin ever gets ambient filesystem access.
3. **Vault**: provider credentials live in the secret store, are injected into the sandbox at run
   time only, are never written to the graph, the run log, the cache key or an AI prompt.
4. **No auto-install**: a new engine passes manifest validation, licence review, dependency review,
   a security check and a health check before it is installable — and installation is a user action
   (brief §75–76).
5. **Data-flow disclosure**: before a run that leaves the machine, Preview shows exactly which
   selector goes to which provider.

---

## 13. Acceptance criteria for the layer

Mirrors brief §110. The layer is done when an analyst can: create a username node, press **Expand**,
see a ranked plan with cost and network disclosure, run it with one action, watch results stream in,
get entities and relationships created automatically, get duplicates merged with visible sources and
engines, chain a further transform from a discovered entity, work with no credentials at all where
a capability genuinely allows it, restrict execution to free or local engines, add a provider key
later without touching the graph, and do all of it inside the canvas.

## 14. Deliberate non-goals

Cloning Maltego's hub, a central transform distribution server, reselling commercial data, agents
without budgets, and any transform whose only implementation would violate a provider's terms.
