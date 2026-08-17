# 06 — NODE SYSTEM

## Scope

Defines the node layer of NEXUS: the `NodeTypeDefinition` registry that makes node types data
rather than engine code, the `EntityBase` fields shared by every node, the complete specification
of all 21 built-in types (zod schema, sizes, LOD appearance, inspector, actions, card states),
rich text, media/file handling, the create→archive lifecycle including async enrichment, and
duplicate/merge semantics. Renderer mechanics live in `05_CANVAS_ENGINE.md`; persistence in
`08_DATA_MODEL.md`; edges in `07_EDGE_SYSTEM.md`. This document never re-decides the stack of
`00_MASTER.md` §2.

---

## 1. Position in the architecture

```text
packages/domain/src/nodes/
├─ base.ts                  EntityBase zod schema + helpers
├─ registry.ts              NodeTypeRegistry (register / get / list / assertComplete)
├─ types/
│  ├─ website.ts  link.ts  text.ts  image.ts  file.ts  evidence.ts
│  ├─ person.ts   username.ts  email.ts  domain.ts  ip.ts  organization.ts
│  ├─ repository.ts  tool-result.ts  hypothesis.ts  group.ts  sticky.ts
│  ├─ embed.ts    location.ts  timeline-event.ts  unknown.ts
├─ lifecycle.ts             create/validate/place/enrich/version/archive/delete
├─ placement.ts             non-overlapping placement algorithm
├─ dedupe.ts                duplicate detection + merge planner
└─ index.ts                 registerBuiltins()

packages/ui/src/nodes/       DOM card components + inspector panels (React)
packages/canvas-engine/src/lod/  L0/L1 canvas painters (no React, no DOM)
```

Hard boundary (enforced by dependency-cruiser, `00_MASTER.md` §5): `packages/domain` contains the
schema, defaults, validation, actions and canvas painters registered as **plain functions**;
`packages/ui` contains the React components. The registry object therefore holds _two_ renderer
surfaces: `paint` (canvas, engine-safe) and `component` (React, resolved lazily by the UI layer
through a `componentId` string, never an imported React element inside `domain`).

```ts
// packages/domain/src/nodes/registry.ts
export const NodeTypeRegistry = {
  register(def: NodeTypeDefinition<any>): void,   // throws on duplicate `type`
  get(type: string): NodeTypeDefinition<any>,      // falls back to `unknown` definition
  list(): NodeTypeDefinition<any>[],
  has(type: string): boolean,
};
```

Adding a node type = adding one file under `types/`, exporting a `NodeTypeDefinition`, and calling
`NodeTypeRegistry.register(def)` in `registerBuiltins()` (or, for plugins, via the host API in
`17_PLUGIN_SDK.md` §4). **No file in `apps/web`, `packages/canvas-engine` or the inspector shell
may switch on `node.type`.** A lint rule (`no-node-type-switch`) forbids `switch (node.type)` and
`node.type === '…'` comparisons outside `packages/domain/src/nodes/` and test files.

---

## 2. `EntityBase` — fields shared by every node

Every node is an entity in the knowledge graph. `EntityBase` is spread into every type schema;
`data` holds the type-specific payload.

```ts
// packages/domain/src/nodes/base.ts
import { z } from 'zod';

export const Confidence = z.enum(['confirmed', 'high', 'medium', 'low', 'unverified']);
export type Confidence = z.infer<typeof Confidence>;

export const ProvenanceKind = z.enum([
  'manual', // typed/drawn by a human
  'paste', // clipboard pipeline (06 §7.1, 03_UX.md §6)
  'import', // file/board import
  'unfurl', // link unfurl worker
  'tool', // integration run (sherlock/spiderfoot/github/…)
  'ai', // accepted AI proposal
  'derived', // computed by NEXUS (merge, cluster, analysis)
]);

export const Provenance = z.object({
  kind: ProvenanceKind,
  source: z.string().max(2048).nullable(), // URL, file name, tool target, or null for manual
  tool: z.string().max(64).nullable(), // integration id, e.g. 'sherlock'
  runId: z.string().ulid().nullable(), // IntegrationRun.id (08 §4.14)
  proposalId: z.string().ulid().nullable(), // AIProposal / ImportProposal that created it
  rawRef: z.string().max(512).nullable(), // S3 key of the raw payload
  observedAt: z.string().datetime(), // when the fact was observed at the source
  importedAt: z.string().datetime(), // when it entered this board
  actorId: z.string().ulid().nullable(), // user who accepted/created
});

export const EntityBase = z.object({
  id: z.string().ulid(),
  type: z.string().min(1).max(48),
  // geometry — canvas units, not pixels (see 05_CANVAS_ENGINE.md §3)
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().min(24).max(8000),
  h: z.number().min(24).max(8000),
  rotation: z.literal(0), // reserved; rotation is not supported in v1 (hit-testing
  // and DOM overlay cost outweigh the value) — see §12 risk
  z: z.number().int(), // paint order within the board
  parentId: z.string().ulid().nullable(), // group/frame membership
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  // knowledge-graph fields
  title: z.string().max(300).default(''),
  tags: z.array(z.string().min(1).max(48)).max(64).default([]),
  confidence: Confidence.default('unverified'),
  provenance: Provenance,
  color: z
    .string()
    .regex(/^--node-[a-z0-9-]+$/)
    .nullable()
    .default(null), // token name only
  starred: z.boolean().default(false),
  // enrichment + lifecycle
  status: z.enum(['draft', 'active', 'archived']).default('active'),
  enrichment: z.object({
    state: z.enum(['idle', 'queued', 'running', 'partial', 'ready', 'failed', 'stale']),
    jobId: z.string().nullable(),
    attempts: z.number().int().min(0).max(5),
    lastError: z.object({ code: z.string(), message: z.string().max(500) }).nullable(),
    updatedAt: z.string().datetime(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().min(1), // bumped by the versioning rules of §9.6
  data: z.unknown(), // narrowed per type
});
export type EntityBase = z.infer<typeof EntityBase>;
```

Rules:

- `id` is a **ULID** (26 chars, lexicographically sortable, generated client-side offline). Same
  choice as the database (`08_DATA_MODEL.md` §3.1) so no id translation ever happens.
- `color` stores a **token name**, never a hex value (`00_MASTER.md` §10.6).
- `provenance` is required by the schema. A node cannot be constructed without it — this is the
  code-level enforcement of principle "every claim has a source" (`00_MASTER.md` §3.4).
- `data` is validated by `def.schema`, which is `EntityBase.extend({ type: z.literal(...), data: ... })`.
- Unknown extra keys are **stripped** on read (`.strip()` default) but preserved in the CRDT map for
  forward compatibility — see `08_DATA_MODEL.md` §2.6 (unknown-key preservation).

---

## 3. `NodeTypeDefinition`

```ts
// packages/domain/src/nodes/types.ts
export interface NodeTypeDefinition<TData> {
  /** stable id, kebab-case, also the DB `nodes.type` value. Never renamed; see §11 migrations. */
  type: string;
  /** human label + plural, i18n keys resolved by the UI layer */
  label: string;
  labelPlural: string;
  /** zod schema for the whole entity (EntityBase.extend). Source of truth for validation. */
  schema: z.ZodType<EntityBase & { type: string; data: TData }>;
  /** icon id from packages/ui/icons (lucide subset, see 04_DESIGN_SYSTEM.md §7) */
  icon: string;
  /** default color token, e.g. '--node-web' */
  colorToken: string;

  defaults: {
    size: { w: number; h: number };
    minSize: { w: number; h: number };
    maxSize: { w: number; h: number };
    /** 'free' | 'width' | 'ratio' — resize behaviour; 'ratio' keeps aspect */
    resize: 'free' | 'width' | 'ratio' | 'none';
    data: TData;
    autoHeight: boolean; // height follows content (text/sticky)
  };

  /** canvas painters, pure functions, no DOM, no React (run inside canvas-engine) */
  paint: {
    l0(ctx: CanvasRenderingContext2D, n: PaintNode, t: PaintTheme): void;
    l1(ctx: CanvasRenderingContext2D, n: PaintNode, t: PaintTheme): void;
    /** optional bitmap the engine may cache for L1 (favicons, thumbnails) */
    bitmapKey?(n: EntityBase & { data: TData }): string | null;
  };

  /** DOM card at L2/L3 — resolved by packages/ui via this id, never imported here */
  componentId: string;
  inspectorId: string;

  /** inspector field descriptors, rendered generically (04_DESIGN_SYSTEM.md §11) */
  inspector: InspectorField[];

  /** context-menu / command-palette actions contributed by this type */
  actions: NodeAction<TData>[];

  capabilities: {
    editableText: boolean; // has inline-editable rich text
    resizable: boolean;
    connectable: boolean; // can be an edge endpoint
    groupable: boolean; // can be placed in a group/frame
    enrichable: boolean; // participates in async enrichment (§9.4)
    duplicatable: boolean;
    hasMedia: boolean; // owns File rows
    isContainer: boolean; // owns children (group/frame)
    aiSummarizable: boolean;
  };

  /** identity for dedupe (§10). Returns normalized keys; empty ⇒ never auto-deduped. */
  identityKeys(n: EntityBase & { data: TData }): string[];

  /** fields fed into Postgres FTS + the client index (07 search, 09_BACKEND.md §7) */
  searchFields(n: EntityBase & { data: TData }): {
    title: string;
    body: string;
    keywords: string[];
  };

  /** capture: can this type be produced from a pasted/dropped payload? (06 §7.1) */
  capture?: {
    match(input: CaptureInput): number; // 0..1 confidence
    build(input: CaptureInput): Partial<TData> & { title?: string };
  };

  io: {
    toExport(n: EntityBase & { data: TData }): unknown; // nexus.board.v1 payload
    fromExport(raw: unknown): EntityBase & { data: TData }; // must round-trip (N9)
    toMarkdown(n: EntityBase & { data: TData }): string;
    csvColumns: string[];
    toCsvRow(n: EntityBase & { data: TData }): (string | number | null)[];
  };

  /** cross-field validation beyond zod; returns user-facing issues */
  validate?(n: EntityBase & { data: TData }): ValidationIssue[];

  /** which edge types this node may be a source/target of; consumed by 07_EDGE_SYSTEM.md §3 */
  edgeAffinity?: { asSource: string[]; asTarget: string[] };
}

export interface InspectorField {
  key: string; // dot-path into the entity, e.g. 'data.url'
  label: string;
  control:
    | 'text'
    | 'textarea'
    | 'url'
    | 'email'
    | 'number'
    | 'select'
    | 'multiselect'
    | 'date'
    | 'datetime'
    | 'toggle'
    | 'tags'
    | 'confidence'
    | 'color'
    | 'richtext'
    | 'file'
    | 'coords'
    | 'readonly'
    | 'json';
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  required?: boolean;
  section: 'identity' | 'content' | 'attributes' | 'provenance' | 'appearance';
  readOnlyWhen?: (n: EntityBase) => boolean;
}

export interface NodeAction<TData> {
  id: string; // 'website.open', 'username.run-sherlock'
  label: string;
  icon: string;
  group: 'primary' | 'transform' | 'tool' | 'ai' | 'danger';
  shortcut?: string; // registered in the command palette (03_UX.md §5)
  enabled(n: EntityBase & { data: TData }, ctx: ActionContext): boolean;
  run(n: EntityBase & { data: TData }, ctx: ActionContext): Promise<ActionResult>;
}
```

`ActionContext` exposes only capability-scoped host APIs: `graph` (mutations through the
transaction helper of `08_DATA_MODEL.md` §2.4), `proposals.create()`, `jobs.enqueue()`,
`files`, `toast`, `navigate`, `user`. Actions **never** write to the graph outside a Yjs
transaction with origin `'local:action'` and **never** bypass proposals for tool/AI output (N4).

`registry.assertComplete()` runs in CI: every registered type must supply non-empty `paint.l0`,
`paint.l1`, `componentId`, `inspectorId`, at least one `io` mapping, and a round-trip property test
fixture in `packages/domain/test/fixtures/nodes/<type>.json`.

### 3.1 LOD contract

Levels come from `05_CANVAS_ENGINE.md` §5. Restated here as the contract node types must satisfy:

| Level | Zoom                 | Surface  | Node must render                                                                                                                                                          |
| ----- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0    | `zoom < 0.28`        | Canvas2D | a 6–10 px rounded glyph in the type color; no text; selection = 2 px outline                                                                                              |
| L1    | `0.28 ≤ zoom < 0.55` | Canvas2D | rounded rect, type color 12% fill, 1 px border, icon 12 px, truncated title (1 line, ellipsis measured with cached `TextMetrics`), optional cached bitmap (favicon/thumb) |
| L2    | `0.55 ≤ zoom < 1.6`  | DOM      | full card, no inline editing, previews at ≤ 256 px, badges collapsed to icons                                                                                             |
| L3    | `zoom ≥ 1.6`         | DOM      | full card + inline editing enabled, full-resolution preview (≤ 1024 px), all badges with text                                                                             |

Painters must be allocation-free per frame: no `new`, no string concatenation, no `toFixed` in
`paint.l0`/`paint.l1`. Precomputed strings live in a per-node paint cache keyed by
`${id}:${version}:${lod}` (`05_CANVAS_ENGINE.md` §6.3).

### 3.2 Card state table (applies to every DOM card, L2/L3)

| State          | Trigger                                 | Visual contract                                                                                                              |
| -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| initial        | mounted, data ready                     | border `--border-subtle`, bg `--surface-1`, shadow none                                                                      |
| hover          | pointer over card                       | border `--border-strong`, shadow `--shadow-1`, action rail fades in over 90 ms                                               |
| focus          | keyboard focus                          | 2 px `--focus-ring` outline, offset 2 px, always visible (N6)                                                                |
| selected       | in selection set                        | 2 px `--accent` border + 1 px inner ring; resize handles at L3 only                                                          |
| multi-selected | ≥2 selected                             | same as selected, action rail hidden, bounding box drawn on canvas                                                           |
| drag           | pointer drag                            | opacity 0.85, shadow `--shadow-3`, DOM card is `will-change: transform`, snapping guides on canvas                           |
| editing        | double-click / Enter at L3              | border `--accent`, content becomes editable, Esc commits                                                                     |
| loading        | `enrichment.state ∈ {queued, running}`  | skeleton blocks (no spinner) for unresolved regions, header shows animated 2 px top bar; reduced-motion → static striped bar |
| partial        | `enrichment.state = 'partial'`          | resolved regions rendered, unresolved show inline `Not available` in `--text-muted`                                          |
| success        | enrichment transitions to `ready`       | 320 ms border pulse to `--positive` then back; reduced-motion → no pulse                                                     |
| error          | `enrichment.state = 'failed'`           | left 3 px `--danger` bar, card body shows `what/why/what to do` (`03_UX.md` §12), `Retry` button                             |
| empty          | required data missing (e.g. url === '') | dashed border, centered call-to-action ("Add a URL"), single input focused on click                                          |
| stale          | `enrichment.state = 'stale'`            | clock badge + tooltip "Data captured {relative}. Refresh"                                                                    |
| locked         | `locked === true`                       | lock badge, no handles, drag/resize refused with a 120 ms shake (reduced-motion → toast)                                     |
| undo-highlight | node touched by an undo/redo            | 500 ms outline in `--accent-muted`, non-blocking                                                                             |

---

## 4. Built-in types — common conventions

- Sizes are canvas units at zoom 1 (= CSS px at 100%).
- All colors below are token names defined in `04_DESIGN_SYSTEM.md` §5 (`--node-*` scale).
- Every type's inspector always shows the shared sections **Provenance** (read-only: kind, source,
  tool, run, observed/imported, actor) and **Appearance** (color token, starred, locked) plus
  **Identity** (title, tags, confidence). Only the type-specific fields are listed per type.
- Every type supports the universal actions: `open-inspector` (Enter), `duplicate` (Ctrl+D),
  `copy` / `cut` / `paste`, `add-tag` (T), `set-confidence` (1–5), `group` (Ctrl+G), `pin-to-timeline`,
  `find-similar`, `delete` (Del, soft, undoable), `ai.summarize` (when `aiSummarizable`),
  `create-edge` (E). Only extra actions are listed per type.

### 4.1 `website`

Captured web page with unfurled metadata. The default result of pasting an `http(s)` URL.

```ts
export const WebsiteData = z.object({
  url: z.string().url().max(2048),
  canonicalUrl: z.string().url().max(2048).nullable(),
  siteName: z.string().max(200).nullable(),
  description: z.string().max(1200).nullable(),
  faviconFileId: z.string().ulid().nullable(),
  screenshotFileId: z.string().ulid().nullable(),
  ogImageFileId: z.string().ulid().nullable(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  finalUrl: z.string().url().max(2048).nullable(), // after redirects (SSRF-capped, N7)
  contentType: z.string().max(120).nullable(),
  lang: z.string().max(16).nullable(),
  publishedAt: z.string().datetime().nullable(),
  author: z.string().max(200).nullable(),
  excerpt: z.string().max(4000).nullable(), // readability extract, sanitized text
  archiveUrl: z.string().url().max(2048).nullable(), // user-supplied or wayback, never auto-fetched
  notes: RichTextRef.nullable(),
});
```

- Required: `url`. Everything else is enrichment output.
- Default size 320×188, min 220×96, max 720×640, `resize: 'width'` (height auto below the preview).
- LOD: **L0** glyph `--node-web`; **L1** favicon bitmap + host name (`new URL(url).host`, cached);
  **L2** favicon + title (2 lines) + host + og image 16:9 cropped, `--node-web` 2 px top edge;
  **L3** adds description (3 lines), captured-at line, and the action rail (Open, Copy URL, Refresh,
  Screenshot).
- Inspector: `data.url` (url, required), `data.title` via `title`, `data.description` (textarea),
  `data.author`, `data.publishedAt` (datetime), `data.archiveUrl` (url), `data.notes` (richtext),
  read-only `httpStatus`, `finalUrl`, `contentType`.
- Actions: `website.open` (⌘↩, opens `finalUrl ?? url` in a new tab with `rel="noreferrer"`),
  `website.copy-url`, `website.refresh` (re-enqueue unfurl), `website.screenshot` (worker job),
  `website.extract-entities` (AI proposal: emails/domains/usernames found in `excerpt`),
  `website.to-domain` (creates a `domain` node + `resolves_to` edge).
- Validation: URL must pass the SSRF guard's _static_ checks client-side (scheme in `http/https`,
  host not in private ranges, no credentials in the URL); the authoritative check is server-side
  (`15_SECURITY.md` §5). Issue code `URL_PRIVATE_RANGE` blocks enrichment but not node creation.
- States: **empty** when `url === ''` (paste target card); **loading** during unfurl; **partial**
  when the fetch succeeded but no og image; **error** on `httpStatus ≥ 400`, network failure, or
  SSRF block — message names the reason and offers `Open anyway` / `Retry` / `Add manually`.

### 4.2 `link`

A bare reference the user does not want unfurled (or that failed unfurl and was demoted). Cheap,
list-friendly, no preview.

```ts
export const LinkData = z.object({
  url: z.string().url().max(2048),
  label: z.string().max(200).nullable(),
  unfurlOptOut: z.boolean().default(false),
});
```

- Default 260×64, min 160×48, max 640×120, `resize: 'width'`, `autoHeight: true`.
- LOD: L0 glyph `--node-link`; L1 chain icon + host; L2/L3 one-line label + host + open affordance.
- Actions: `link.open`, `link.copy-url`, `link.promote-to-website` (runs unfurl, converts type
  in-place preserving `id`, edges and provenance — see §11 type conversion).
- Empty state: dashed pill "Paste a link". Error state only for malformed URL (inline, red text).

### 4.3 `text` (rich note)

The primary writing surface. Backed by a `Y.XmlFragment` (see §5, `08_DATA_MODEL.md` §2.3).

```ts
export const TextData = z.object({
  fragmentKey: z.string().min(1).max(64), // key into Y.Doc `richtext` map
  plain: z.string().max(20000), // denormalized plain text for search/L1
  format: z.enum(['rich', 'markdown', 'code']).default('rich'),
  codeLanguage: z.string().max(32).nullable(),
  collapsed: z.boolean().default(false),
});
```

- Default 320×200, min 120×64, max 1200×3000, `resize: 'free'`, `autoHeight: true` when the content
  is shorter than `h`.
- LOD: L0 glyph `--node-text`; L1 3 grey "text lines" bars proportional to `plain.length` + title;
  L2 rendered rich text, no editing, max 12 visible lines then a fade mask; L3 full editor.
- Inspector: `title`, `data.format` (select), `data.codeLanguage` (select, visible when
  `format==='code'`), word/char count (readonly), `tags`, `confidence`.
- Actions: `text.toggle-format`, `text.extract-entities` (AI), `text.split-to-nodes` (each top-level
  H2 becomes a new `text` node, linked with `derived_from` edges — as a proposal, N4),
  `text.copy-markdown`.
- Empty: placeholder "Write, paste, or press / for blocks". Error: only if the fragment is missing
  (corrupt import) → card shows `Content unavailable` + `Restore from snapshot` action.

### 4.4 `image`

```ts
export const ImageData = z.object({
  fileId: z.string().ulid(), // File row (08 §4.13)
  naturalWidth: z.number().int().positive(),
  naturalHeight: z.number().int().positive(),
  crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
  fit: z.enum(['cover', 'contain']).default('cover'),
  alt: z.string().max(500).default(''),
  caption: z.string().max(1000).nullable(),
  sourceUrl: z.string().url().max(2048).nullable(),
  ocrText: z.string().max(20000).nullable(), // enrichment, opt-in per workspace
  dominantColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .nullable(),
  blurhash: z.string().max(64).nullable(),
});
```

- Default: fit the natural size into a 360×360 box preserving ratio; min 64×64; max 2000×2000;
  `resize: 'ratio'` (Alt disables ratio lock and switches `fit` to `cover` with a crop).
- LOD: L0 glyph `--node-image`; L1 the 64 px thumbnail bitmap, or a `dominantColor` rect if the
  thumbnail is not yet decoded; L2 the 512 px thumbnail; L3 the 1024 px rendition, full original
  only in the fullscreen viewer.
- Inspector: `data.alt` (text, required for a11y — empty triggers a warning issue, not an error),
  `data.caption`, `data.sourceUrl`, `data.fit`, crop editor button, EXIF summary (readonly, see §6.2),
  `data.ocrText` (readonly, collapsible).
- Actions: `image.fullscreen` (Space), `image.crop`, `image.replace`, `image.download`,
  `image.copy-image`, `image.ocr` (worker job → proposal), `image.reverse-search` (copies the image
  URL and opens the user-configured search engine; no bundled engine).
- States: loading = blurhash/dominant color + skeleton; error = "Image could not be loaded" with the
  file name and `Retry` / `Replace`; empty = drop target with dashed border.

### 4.5 `file`

```ts
export const FileData = z.object({
  fileId: z.string().ulid(),
  fileName: z.string().max(255),
  mime: z.string().max(160),
  size: z.number().int().nonnegative(),
  previewFileId: z.string().ulid().nullable(), // rendered page-1 / waveform / poster
  pageCount: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  extractedText: z.string().max(200000).nullable(),
  hashSha256: z.string().length(64),
  virusScan: z.enum(['pending', 'clean', 'flagged', 'skipped']).default('pending'),
});
```

- Default 280×120 (no preview) / 280×220 (with preview); min 200×88; max 720×900; `resize: 'width'`.
- LOD: L0 glyph `--node-file`; L1 format badge (PDF/DOCX/CSV…) + truncated file name; L2 preview
  thumbnail + name + size; L3 adds page/duration, hash prefix (first 12 chars, monospace), scan badge.
- Actions: `file.open-preview`, `file.download`, `file.extract-text` (→ creates a `text` node via a
  proposal), `file.replace`, `file.copy-hash`.
- Validation: `size ≤ 200 MB` (workspace setting, `08 §4.28`); `virusScan === 'flagged'` renders the
  error state, blocks download and preview.

### 4.6 `evidence`

A note that asserts something, with an explicit claim/source pair. This is the OSINT primitive that
differentiates NEXUS from a whiteboard.

```ts
export const EvidenceData = z.object({
  claim: z.string().min(1).max(2000),
  fragmentKey: z.string().max(64).nullable(), // rich body/reasoning
  sourceUrls: z.array(z.string().url().max(2048)).max(20).default([]),
  sourceFileIds: z.array(z.string().ulid()).max(20).default([]),
  method: z.enum(['observation', 'tool', 'inference', 'testimony', 'document']),
  reliability: z.enum(['A', 'B', 'C', 'D', 'E', 'F']), // Admiralty source reliability
  credibility: z.enum(['1', '2', '3', '4', '5', '6']), // Admiralty information credibility
  collectedAt: z.string().datetime(),
  collectorId: z.string().ulid().nullable(),
});
```

- Admiralty code (A1…F6) is rendered as a two-character badge; it is the standard analyst grading
  scale and maps deterministically to `confidence` when the user has not overridden it:
  `A/B × 1/2 → high`, `C × 1..3 → medium`, everything else `low`, `F` or `6` → `unverified`.
- Default 320×220, min 240×140, `resize: 'width'`, `autoHeight: true`.
- LOD: L1 shows the Admiralty badge + first 40 chars of `claim`.
- Actions: `evidence.add-source` (paste URL / attach file), `evidence.link-to-hypothesis`
  (creates `supports` or `contradicts` edge — type chosen in the dialog), `evidence.copy-citation`
  (formats `claim — source (observedAt)` as Markdown).
- Validation: at least one of `sourceUrls`/`sourceFileIds` **or** `method === 'inference'`; violation
  is a _warning_ rendered in the card footer ("Unsourced claim"), never a hard block.

### 4.7 `person` (identity)

```ts
export const PersonData = z.object({
  displayName: z.string().max(200),
  aliases: z.array(z.string().max(120)).max(50).default([]),
  usernames: z.array(z.string().max(120)).max(100).default([]),
  emails: z.array(z.string().email().max(320)).max(50).default([]),
  phones: z.array(z.string().max(40)).max(20).default([]),
  avatarFileId: z.string().ulid().nullable(),
  birthDate: z.string().date().nullable(),
  country: z.string().length(2).nullable(), // ISO 3166-1 alpha-2
  city: z.string().max(120).nullable(),
  employer: z.string().max(200).nullable(),
  role: z.string().max(200).nullable(),
  profileUrls: z
    .array(
      z.object({
        platform: z.string().max(60),
        url: z.string().url().max(2048),
        verified: z.boolean().default(false),
      }),
    )
    .max(100)
    .default([]),
  riskFlags: z.array(z.enum(['minor', 'sensitive-category', 'legal-hold'])).default([]),
  fragmentKey: z.string().max(64).nullable(),
});
```

- `riskFlags` drive the acceptable-use guardrails of `15_SECURITY.md` §9: a person node flagged
  `minor` or `sensitive-category` disables all outbound tool actions on that subtree and shows a
  persistent banner in the inspector.
- Default 300×160; min 220×120; `resize: 'width'`.
- LOD: L1 avatar circle bitmap (24 px) + display name.
- Actions: `person.expand-usernames` (creates a `username` node per entry + `has_account` edges,
  as a proposal), `person.run-sherlock` (only when ≥1 username; opens the run dialog of
  `13_SHERLOCK.md` §3), `person.merge-with…` (§10).
- L2 card: avatar, name, role@employer, chips for `aliases` count / accounts count / emails count.
- Error state: none intrinsic; enrichment errors come from child username nodes.

### 4.8 `username`

```ts
export const UsernameData = z.object({
  handle: z.string().min(1).max(120),
  platform: z.string().max(60).nullable(), // null = platform-agnostic handle
  profileUrl: z.string().url().max(2048).nullable(),
  exists: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  checkedAt: z.string().datetime().nullable(),
  checkedBy: z.string().max(64).nullable(), // 'sherlock' | 'manual' | 'spiderfoot'
  followers: z.number().int().nonnegative().nullable(),
  bio: z.string().max(2000).nullable(),
  avatarFileId: z.string().ulid().nullable(),
  siteCount: z.number().int().nonnegative().nullable(), // sites checked in the producing run
});
```

- `handle` is normalized for identity: lowercase, strip a leading `@`, NFKC. `identityKeys` returns
  `["username:" + platformOrAny + ":" + normalized]`.
- Default 240×96; min 180×72.
- LOD: L1 `@handle` + platform glyph; existence is encoded as a 4 px left bar (`--positive` yes,
  `--text-muted` no, `--warning` unknown).
- Actions: `username.run-sherlock` (Sherlock v0.16.0 CLI via the runner; flags `--json`, `--timeout`,
  `--print-found`, optional `--site`, `--nsfw`, `--proxy` per `13_SHERLOCK.md` §4), `username.open-profile`,
  `username.mark-exists` / `mark-not-exists` (sets `checkedBy='manual'`).
- Loading state during a Sherlock run: card shows `Checking N sites…` with a determinate bar fed by
  run progress events; if progress is unavailable the bar is indeterminate (adapter assumption:
  Sherlock's stdout line cadence is _not_ a stable API — the fallback is the indeterminate bar and a
  final result diff, see `13_SHERLOCK.md` §6).

### 4.9 `email`

```ts
export const EmailData = z.object({
  address: z.string().email().max(320),
  local: z.string().max(64), // derived, denormalized for search
  domain: z.string().max(255), // derived
  valid: z.enum(['syntax-ok', 'mx-ok', 'invalid', 'unknown']).default('syntax-ok'),
  breachCount: z.number().int().nonnegative().nullable(), // only from an installed integration
  disposable: z.boolean().nullable(),
  firstSeen: z.string().datetime().nullable(),
});
```

- 240×88; L1 shows the address, ellipsized in the middle (`a…@example.com`) so the domain stays readable.
- Actions: `email.copy`, `email.to-domain` (creates/links `domain` node with `part_of`),
  `email.check-mx` (worker DNS job; result sets `valid`).
- `identityKeys`: `["email:" + address.toLowerCase()]` (Gmail dot/plus normalization is **not**
  applied automatically — it is wrong for most providers; offered as an explicit merge suggestion).

### 4.10 `domain`

```ts
export const DomainData = z.object({
  name: z.string().max(255), // punycode-normalized, lowercased, no trailing dot
  unicodeName: z.string().max(255).nullable(),
  registrar: z.string().max(200).nullable(),
  registeredAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  nameservers: z.array(z.string().max(255)).max(20).default([]),
  records: z
    .array(
      z.object({
        type: z.enum(['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA']),
        value: z.string().max(2048),
        ttl: z.number().int().nullable(),
      }),
    )
    .max(200)
    .default([]),
  tlsIssuer: z.string().max(200).nullable(),
  tlsExpiresAt: z.string().datetime().nullable(),
  asn: z.string().max(32).nullable(),
});
```

- 300×140; L1 shows the registrable domain in monospace.
- Actions: `domain.resolve` (worker DNS), `domain.run-spiderfoot` (scan dialog, `12_SPIDERFOOT.md` §3),
  `domain.open-in-browser`, `domain.expand-records` (creates `ip` nodes + `resolves_to` edges as a
  proposal).
- Validation: reject IP literals (they belong to `ip`), reject labels > 63 chars, total > 253.

### 4.11 `ip`

```ts
export const IpData = z.object({
  address: z.string().max(45),
  version: z.union([z.literal(4), z.literal(6)]),
  asn: z.string().max(32).nullable(),
  asnOrg: z.string().max(200).nullable(),
  country: z.string().length(2).nullable(),
  city: z.string().max(120).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  ptr: z.string().max(255).nullable(),
  openPorts: z.array(z.number().int().min(1).max(65535)).max(200).default([]),
  isPrivate: z.boolean(),
  firstSeen: z.string().datetime().nullable(),
});
```

- 280×132. `isPrivate` is computed on write (RFC1918/RFC4193/loopback/link-local); private IPs render
  a muted "private range" chip and **all outbound tooling actions on them are disabled** (N7 posture).
- Appears on the map view when `lat/lon` present (`14_AI_AGENT.md` is unrelated; map is `01/14 views`,
  spec in the views document of phase 14).

### 4.12 `organization`

```ts
export const OrganizationData = z.object({
  name: z.string().max(300),
  legalName: z.string().max(300).nullable(),
  domains: z.array(z.string().max(255)).max(50).default([]),
  country: z.string().length(2).nullable(),
  registrationId: z.string().max(120).nullable(),
  industry: z.string().max(120).nullable(),
  founded: z.string().date().nullable(),
  logoFileId: z.string().ulid().nullable(),
  aliases: z.array(z.string().max(200)).max(50).default([]),
  fragmentKey: z.string().max(64).nullable(),
});
```

- 300×150; L1 logo bitmap + name. Actions: `org.expand-domains`, `org.merge-with…`,
  `org.link-people` (opens a picker; creates `member_of` edges).

### 4.13 `repository`

Data mirrors what `11_GITHUB.md` §5 extracts; no field here implies an API endpoint that document
does not define.

```ts
export const RepositoryData = z.object({
  provider: z.enum(['github', 'gitlab', 'other']).default('github'),
  owner: z.string().max(120),
  name: z.string().max(140),
  url: z.string().url().max(2048),
  defaultBranch: z.string().max(160).nullable(),
  description: z.string().max(2000).nullable(),
  stars: z.number().int().nonnegative().nullable(),
  forks: z.number().int().nonnegative().nullable(),
  openIssues: z.number().int().nonnegative().nullable(),
  license: z.string().max(80).nullable(),
  primaryLanguage: z.string().max(60).nullable(),
  languages: z.record(z.string().max(60), z.number()).default({}),
  topics: z.array(z.string().max(60)).max(50).default([]),
  pushedAt: z.string().datetime().nullable(),
  archived: z.boolean().nullable(),
  readmeFragmentKey: z.string().max(64).nullable(),
  analysisId: z.string().ulid().nullable(), // RepositoryAnalysis row (08 §4.18)
  lastAnalyzedAt: z.string().datetime().nullable(),
});
```

- 360×220; min 260×140; `resize: 'width'`.
- L2 card: owner/name, language dot + name, stars/forks/issues chips, license, "analyzed {when}".
- Actions: `repo.open`, `repo.sync` (re-fetch metadata), `repo.analyze` (queues the repository
  analysis agent, `11_GITHUB.md` §7; result arrives as a proposal), `repo.expand-contributors`
  (creates `person` nodes + `contributed_to` edges), `repo.expand-releases` (timeline events).
- Loading state during analysis shows a 5-step checklist (clone → structure → deps → docs →
  summary), each step `pending/active/done/failed`.

### 4.14 `tool-result`

The immutable record of one integration run rendered on the canvas. Never edited by hand.

```ts
export const ToolResultData = z.object({
  tool: z.string().max(64), // 'sherlock' | 'spiderfoot' | 'github' | plugin id
  toolVersion: z.string().max(40), // e.g. 'sherlock 0.16.0'
  runId: z.string().ulid(),
  target: z.string().max(500),
  status: z.enum(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'timeout']),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  summary: z.string().max(2000).nullable(),
  counts: z.record(z.string().max(40), z.number().int()).default({}), // e.g. {found: 12, checked: 412}
  rawRef: z.string().max(512).nullable(), // S3 key of raw JSON
  producedNodeIds: z.array(z.string().ulid()).max(5000).default([]),
  exitCode: z.number().int().nullable(),
  errorCode: z.string().max(80).nullable(),
});
```

- 340×200; `capabilities.editableText = false`, inspector fully read-only except `title`/`tags`.
- Actions: `run.open-log`, `run.view-raw` (opens the raw payload viewer, JSON tree, read-only),
  `run.rerun` (creates a new run, never mutates this node), `run.select-produced` (selects all
  `producedNodeIds` on the canvas), `run.export-json`.
- States: `running` → progress card with elapsed timer and `Cancel`; `timeout`/`failed` → error card
  with the runner's structured error (`10_INTEGRATIONS.md` §8 error taxonomy) and `Rerun with a
longer timeout`; `partial` → yellow bar + "N of M sites answered".

### 4.15 `hypothesis`

```ts
export const HypothesisData = z.object({
  statement: z.string().min(1).max(1000),
  status: z.enum(['open', 'supported', 'contradicted', 'inconclusive', 'closed']).default('open'),
  probability: z.number().min(0).max(1).nullable(), // analyst estimate, manual
  rationaleFragmentKey: z.string().max(64).nullable(),
  supportCount: z.number().int().nonnegative().default(0), // derived, recomputed on edge change
  contradictCount: z.number().int().nonnegative().default(0), // derived
  decidedAt: z.string().datetime().nullable(),
});
```

- `supportCount`/`contradictCount` are **derived** fields recomputed by the domain layer whenever an
  incident `supports`/`contradicts` edge changes (`07_EDGE_SYSTEM.md` §3). They are written inside
  the same Yjs transaction as the edge mutation so undo restores them atomically.
- 340×180; L1 shows the status glyph (open ◦, supported ▲, contradicted ▼) + first words.
- Actions: `hypothesis.set-status`, `hypothesis.gather-evidence` (selects all connected evidence),
  `hypothesis.ai-assess` (AI proposal that only _suggests_ a status + rationale; never applies).

### 4.16 `group` (frame)

```ts
export const GroupData = z.object({
  kind: z.enum(['frame', 'cluster']).default('frame'),
  label: z.string().max(200).default(''),
  collapsed: z.boolean().default(false),
  autoLayout: z.enum(['none', 'grid', 'stack', 'force']).default('none'),
  padding: z.number().int().min(0).max(200).default(24),
  childIds: z.array(z.string().ulid()).max(5000).default([]),
  background: z
    .string()
    .regex(/^--node-[a-z0-9-]+$/)
    .nullable(),
});
```

- `isContainer: true`. Children reference the group through `parentId`; `childIds` is the ordered
  mirror used for stable z-order and layout. The invariant `child.parentId === group.id ⟺
group.data.childIds.includes(child.id)` is asserted by `checkGraphInvariants()` and repaired on
  load (`08_DATA_MODEL.md` §7.3).
- Default 640×420; min 160×120; `resize: 'free'`; painted **behind** all non-group nodes (z floor).
- Collapsed: renders as a 280×72 bar with the label + child count; children are `hidden` for the
  renderer but keep their coordinates; edges crossing the boundary are re-anchored to the collapsed
  bar (`07_EDGE_SYSTEM.md` §9.2).
- Actions: `group.collapse/expand`, `group.layout` (grid/stack/force, preview + apply),
  `group.select-children`, `group.ungroup`, `group.export-subgraph`.

### 4.17 `sticky`

Fast, low-ceremony annotation. Plain text only — deliberately not rich, so it stays cheap at L1 and
cannot become a hidden document.

```ts
export const StickyData = z.object({
  text: z.string().max(2000),
  colorIndex: z.number().int().min(0).max(7).default(0), // maps to --sticky-0..7
  fontSize: z.enum(['s', 'm', 'l', 'auto']).default('auto'),
  align: z.enum(['left', 'center']).default('left'),
});
```

- 200×200, min 120×120, max 600×600, `resize: 'free'`. `auto` font size solves for the largest of
  {12, 14, 16, 20, 24, 32} px that fits `text` in the box (binary search over the measured height,
  recomputed on resize/edit only, cached by `${w}x${h}:${text.length}`).
- L1 renders a solid color rect with 2 text bars — no glyph, so a wall of stickies stays readable
  when zoomed out.

### 4.18 `embed`

```ts
export const EmbedData = z.object({
  url: z.string().url().max(2048),
  providerId: z.string().max(60), // 'youtube' | 'vimeo' | 'figma' | 'generic'
  embedUrl: z.string().url().max(2048),
  aspect: z
    .number()
    .min(0.2)
    .max(5)
    .default(16 / 9),
  thumbnailFileId: z.string().ulid().nullable(),
  title: z.string().max(300).nullable(),
  allowInteractive: z.boolean().default(false),
});
```

- Iframes are **never** mounted automatically. The card shows the thumbnail + play affordance; the
  iframe mounts only after an explicit click, into a `sandbox="allow-scripts allow-same-origin
allow-popups"` frame with `referrerpolicy="no-referrer"` and `allow=""` (no camera/mic/geo).
  Unmounts on deselect or when it leaves the viewport. Rationale: an autoplaying third-party iframe
  destroys the frame budget (N1) and is an untrusted execution surface (`15_SECURITY.md` §6).
- Provider list is a static allowlist table in `packages/domain/src/nodes/types/embed.ts`; unknown
  providers become `generic` and render as a `website` style card with an `Open` button only.
  Adapter assumption: provider embed URL shapes are validated at runtime by a regex table; if a URL
  fails the shape check the node degrades to `link`, and a toast explains why.
- 480×270, `resize: 'ratio'`.

### 4.19 `location`

```ts
export const LocationData = z.object({
  label: z.string().max(300),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  precisionMeters: z.number().positive().max(1_000_000).nullable(),
  address: z.string().max(500).nullable(),
  country: z.string().length(2).nullable(),
  source: z.enum(['manual', 'exif', 'geoip', 'tool', 'ai']).default('manual'),
  mapThumbFileId: z.string().ulid().nullable(),
  observedAt: z.string().datetime().nullable(),
});
```

- 300×200. The card shows a **static** map thumbnail only (rendered by the worker from the
  workspace-configured tile source; if none is configured the card shows a coordinate grid
  placeholder — no third-party tiles are fetched from the browser by default, a privacy requirement
  for OSINT users).
- Actions: `location.copy-coords` (decimal + DMS), `location.open-in-maps` (uses the workspace's
  configured map URL template), `location.set-precision`.

### 4.20 `timeline-event`

```ts
export const TimelineEventData = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullable(),
  allDay: z.boolean().default(false),
  timezone: z.string().max(64).default('UTC'),
  precision: z.enum(['exact', 'minute', 'hour', 'day', 'month', 'year', 'approx']).default('exact'),
  category: z.string().max(60).nullable(),
  description: z.string().max(4000).nullable(),
  relatedNodeIds: z.array(z.string().ulid()).max(200).default([]),
});
```

- 320×140. Validation: `endAt === null || endAt ≥ startAt` (`TIME_RANGE_INVERTED`).
- This is the only node type the timeline view treats as a first-class band; every other node may
  still appear on the timeline through `provenance.observedAt`.
- Actions: `event.shift-time`, `event.set-precision`, `event.link-related`.

### 4.21 `unknown` (fallback)

Not user-creatable. Produced when a board is loaded that contains a `type` the registry does not
know (older client, uninstalled plugin). Renders a neutral card with the raw type name, a
read-only JSON inspector, and the actions `copy-json`, `delete`. All original keys are preserved
verbatim so a re-export is lossless (N9) and installing the plugin restores the real card without
data loss.

### 4.22 Type summary table

| type           | default w×h | resize | connectable | enrichable | container | color token         |
| -------------- | ----------- | ------ | ----------- | ---------- | --------- | ------------------- |
| website        | 320×188     | width  | ✓           | ✓          | –         | `--node-web`        |
| link           | 260×64      | width  | ✓           | –          | –         | `--node-link`       |
| text           | 320×200     | free   | ✓           | –          | –         | `--node-text`       |
| image          | ≤360 box    | ratio  | ✓           | ✓          | –         | `--node-media`      |
| file           | 280×120     | width  | ✓           | ✓          | –         | `--node-file`       |
| evidence       | 320×220     | width  | ✓           | –          | –         | `--node-evidence`   |
| person         | 300×160     | width  | ✓           | ✓          | –         | `--node-identity`   |
| username       | 240×96      | width  | ✓           | ✓          | –         | `--node-identity`   |
| email          | 240×88      | width  | ✓           | ✓          | –         | `--node-identity`   |
| domain         | 300×140     | width  | ✓           | ✓          | –         | `--node-infra`      |
| ip             | 280×132     | width  | ✓           | ✓          | –         | `--node-infra`      |
| organization   | 300×150     | width  | ✓           | ✓          | –         | `--node-org`        |
| repository     | 360×220     | width  | ✓           | ✓          | –         | `--node-code`       |
| tool-result    | 340×200     | width  | ✓           | –          | –         | `--node-tool`       |
| hypothesis     | 340×180     | width  | ✓           | –          | –         | `--node-hypothesis` |
| group          | 640×420     | free   | –           | –          | ✓         | `--node-group`      |
| sticky         | 200×200     | free   | ✓           | –          | –         | `--sticky-0..7`     |
| embed          | 480×270     | ratio  | ✓           | ✓          | –         | `--node-media`      |
| location       | 300×200     | width  | ✓           | ✓          | –         | `--node-geo`        |
| timeline-event | 320×140     | width  | ✓           | –          | –         | `--node-time`       |
| unknown        | 280×140     | free   | ✓           | –          | –         | `--node-unknown`    |

---

## 5. Rich text

### 5.1 Chosen approach

**TipTap 2 (ProseMirror) bound to `Y.XmlFragment` via `y-prosemirror`.** Justification in one line:
it is the only mature editor with an official, production-proven Yjs binding, so rich text inherits
the same CRDT, the same `Y.UndoManager` and the same offline story as the rest of the document
(`00_MASTER.md` §2) instead of introducing a second conflict model.

Consequences:

- Each rich-text-bearing node stores `fragmentKey`; the fragment lives in the board's
  `Y.Map<'richtext'>` (see `08_DATA_MODEL.md` §2.3). The node itself never stores HTML.
- The editor instance is created **only** for the focused node at L3, one at a time. Non-focused
  cards render a static, memoized HTML string produced from the fragment by a pure serializer
  (`fragmentToHtml`), cached by `${fragmentKey}:${fragmentVersion}`. This keeps 5,000 nodes from
  mounting 5,000 ProseMirror instances (N1).
- Undo inside the editor uses the same board `Y.UndoManager` scoped to the local origin, so Ctrl+Z
  in text and Ctrl+Z on the canvas are one continuous stack (N3).

### 5.2 Supported set (closed — anything not listed is stripped)

Blocks: `paragraph`, `heading` (levels 1–3), `bulletList`, `orderedList`, `listItem`,
`taskList`, `taskItem` (checkbox), `blockquote`, `codeBlock` (with language attr),
`horizontalRule`, `table` (with `tableRow`/`tableCell`/`tableHeader`), `image` (inline reference to
a `File` id, never a remote URL), `callout` (custom node, `variant: info|warn|danger|note`).

Marks: `bold`, `italic`, `strike`, `code`, `underline`, `link` (href validated by the same URL
guard as §4.1, `rel="noreferrer nofollow"`), `highlight` (4 token colors), `mention`, `tag`.

Not supported and deliberately so: font families, arbitrary colors, font sizes, text alignment
beyond default, embedded HTML, raw iframes. Rationale: they break the token system
(`00_MASTER.md` §10.6) and make Markdown round-tripping lossy.

### 5.3 Markdown fidelity

`toMarkdown` / `fromMarkdown` live in `packages/domain/src/richtext/markdown.ts` and use
CommonMark + GFM tables/task lists.

| Construct               | MD out                        | MD in | Lossless round-trip                                                         |
| ----------------------- | ----------------------------- | ----- | --------------------------------------------------------------------------- |
| paragraph, heading 1–3  | `#`,`##`,`###`                | yes   | ✓                                                                           |
| bold/italic/strike/code | `**`,`*`,`~~`,`` ` ``         | yes   | ✓                                                                           |
| link                    | `[t](url)`                    | yes   | ✓                                                                           |
| bullet/ordered list     | `-`, `1.`                     | yes   | ✓                                                                           |
| task list               | `- [ ]` / `- [x]`             | yes   | ✓                                                                           |
| blockquote              | `>`                           | yes   | ✓                                                                           |
| code block              | fenced + lang                 | yes   | ✓                                                                           |
| table                   | GFM pipe table                | yes   | ✓ (alignment normalized to left)                                            |
| horizontal rule         | `---`                         | yes   | ✓                                                                           |
| image                   | `![alt](nexus-file:<fileId>)` | yes   | ✓ within a project archive                                                  |
| callout                 | `> [!INFO]` GFM-alert syntax  | yes   | ✓                                                                           |
| mention                 | `[@Name](nexus-node:<id>)`    | yes   | ✓                                                                           |
| tag                     | `#tag`                        | yes   | ✓ unless the text legitimately starts with `#` at line start → escaped `\#` |
| highlight               | `==text==`                    | yes   | ✓ (non-CommonMark; documented extension)                                    |

Import of unsupported Markdown (footnotes, definition lists, raw HTML) degrades to plain paragraphs
and raises a non-blocking import warning listing the dropped constructs and their line numbers.

### 5.4 Mentions and tag autocomplete

- `@` opens the node mention menu: fuzzy search over the board's search index (title + type +
  identity keys), 8 results, keyboard-navigable, Enter inserts a `mention` mark bound to the node
  id. Inserting a mention **also** creates a `references` edge as a _suggestion chip_ in the card
  footer ("Link these nodes?") — never automatically (principle 3, `00_MASTER.md` §3).
- `#` opens tag autocomplete: existing project tags ranked by usage, then "Create tag `x`".
  Tag names are normalized: NFKC, lowercase, spaces → `-`, max 48 chars, `[a-z0-9-_/]` only
  (`/` allows hierarchical tags, e.g. `case/2026-04`).
- `/` opens the block menu (slash command) listing the block set of §5.2 plus "Insert image",
  "Insert file", "Split into node".
- Deleting a mentioned node leaves the mention mark rendered as strikethrough with a tooltip
  "Node deleted"; restoring the node from the trash restores the live mention.

### 5.5 Paste sanitization

Pipeline for a paste into the editor (`03_UX.md` §6 covers canvas-level paste):

1. Prefer `text/html`; else `text/plain` parsed as Markdown when it matches ≥2 Markdown signals
   (fenced code, list markers, headings, links), else literal text.
2. Parse HTML with `DOMParser` into a detached document. Never `innerHTML` into the live DOM.
3. Strip: `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, event
   handler attributes (`on*`), `style` attributes, `class`, `id`, `data-*`, and any `javascript:` /
   `data:` (except `data:image/*` ≤ 2 MB, which is converted to a File upload) URL.
4. Map the surviving tree onto the allowed schema of §5.2; unknown elements unwrap to their children.
5. Remote `<img src>`: not fetched inline. Each becomes a queued image import job that downloads
   server-side through the SSRF-guarded fetcher (N7), stores a File, and rewrites the reference.
   Until then the image renders as a placeholder with the origin host visible.
6. Cap: 200 KB of HTML, 50,000 characters, 200 images per paste. Above the cap the paste is
   truncated at a block boundary and a toast states exactly what was dropped.

---

## 6. Media and files

### 6.1 Accepted formats

| Class        | Accepted                                            | Preview strategy                                                                               |
| ------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Raster image | png, jpeg, webp, avif, gif (first frame), bmp, tiff | decoded + re-encoded thumbnails                                                                |
| Vector       | svg                                                 | sanitized (see below), rasterized preview at 512 px                                            |
| Document     | pdf                                                 | page 1 rendered to webp at 1024 px, text extracted                                             |
| Office       | docx, xlsx, pptx                                    | icon + extracted text; no visual render in v1                                                  |
| Text/data    | txt, md, csv, tsv, json, log, yaml                  | first 40 lines in a monospace preview; csv/tsv render a 10×6 table                             |
| Archive      | zip, tar, tar.gz                                    | listing of up to 200 entries, no extraction                                                    |
| Audio/video  | mp3, wav, m4a, mp4, webm, mov                       | poster frame (video) / waveform png (audio) + duration; playback only in the fullscreen viewer |
| Other        | any                                                 | generic file card, download only                                                               |

SVG is sanitized server-side (strip `script`, `foreignObject`, event attributes, external
references) and is **never** rendered inline in the app; only its rasterization is displayed.
MIME is determined by server-side content sniffing, not by the client-declared type
(`00_MASTER.md` §2, files row).

### 6.2 Image processing pipeline (worker)

1. Verify magic bytes; reject mismatch with `FILE_TYPE_MISMATCH`.
2. Read EXIF: keep `DateTimeOriginal`, `Make`, `Model`, `Orientation`, `GPSLatitude/Longitude` into
   `File.metadata` (jsonb, `08_DATA_MODEL.md` §4.13), then **strip all EXIF from the stored
   renditions**. The original is stored EXIF-intact only when the workspace setting
   `preserveOriginalExif` is on (default **on** for OSINT evidence integrity; the strip always
   applies to derived renditions and to anything exported for sharing).
3. Apply EXIF orientation by baking rotation into the pixels; set orientation to 1.
4. Generate renditions: `thumb` 64 px (long edge, webp q60), `card` 512 px (webp q72),
   `view` 1024 px (webp q80), `full` = original. Never upscale.
5. Compute `blurhash` (4×3) and `dominantColor`.
6. If GPS present, offer (as a proposal) a `location` node with `source: 'exif'` and a
   `depicted_at` edge.

Crop semantics: `crop` is stored in **normalized natural-image coordinates** (0..1) so it survives
re-rendition. Resize on canvas changes `w`/`h` only; it never re-crops. `fit: 'cover'` centers on
the crop rect; `fit: 'contain'` letterboxes with `--surface-2`.

Fullscreen viewer: Space or double-click. Fits to viewport, wheel/pinch zoom 0.1×–8×, drag to pan,
`←/→` walks the current selection or the board's image nodes in z-order, `i` toggles the metadata
panel, Esc closes and restores focus to the card. Reduced-motion disables the zoom transition.

### 6.3 Lazy loading and decoding

- Thumbnails are requested only for nodes intersecting the viewport expanded by 1.5 screens.
- Loads go through a bounded queue: max 6 concurrent decodes, priority = distance from viewport
  center. `createImageBitmap` off the main thread where supported; `img.decode()` fallback.
- Decoded bitmaps live in an LRU keyed by `${fileId}:${rendition}` with a 160 MB budget
  (`16_PERFORMANCE.md` §5); eviction is by last-paint time.
- A node that has been evicted repaints at L1 from `dominantColor` while re-decoding — never a blank.

### 6.4 OPFS / S3 dual store

Every file has two homes and one identity (`File.id`, ULID; content-addressed by `sha256`).

```ts
interface BlobStore {
  put(id: string, blob: Blob, meta: BlobMeta): Promise<void>;
  get(id: string, rendition: Rendition): Promise<Blob | null>;
  has(id: string, rendition: Rendition): Promise<boolean>;
  evict(id: string): Promise<void>;
  usage(): Promise<{ bytes: number; quota: number }>;
}
```

- **OPFS** (`navigator.storage.getDirectory()`) holds: every file the user added on this device
  (originals) until uploaded and acked, plus a cache of `thumb`/`card` renditions for boards the
  user has opened. Layout: `/nexus/<projectId>/<fileId>/<rendition>`.
- **S3/MinIO** holds the durable copy; uploads are presigned, multipart above 8 MB, resumable by
  re-requesting the presign with the same `sha256` (server dedupes by hash within the project).
- Write path: write to OPFS → mark `File.state='local'` → enqueue upload → on ack `state='synced'`
  → renditions are generated server-side and their keys patched into the File row → the client
  invalidates its rendition cache for that id.
- Read path: OPFS hit → return; miss → presigned GET → store `thumb`/`card` back into OPFS.
- Quota: request persistent storage; when `usage > 80%` of quota, evict `view`/`full` renditions of
  boards not opened in 14 days, oldest first; never evict a `local` original that has not been
  acked. When quota cannot be satisfied for a `local` original, the add is rejected with a precise
  error ("Not enough local storage for a 40 MB file — free space or connect to sync first").
- Offline: adding files works fully offline; the file card shows a `Local only` chip until acked.

---

## 7. Capture → node

### 7.1 Capture resolution

`resolveCapture(input: CaptureInput): CaptureCandidate[]` collects `def.capture.match(input)` from
every registered type, sorts descending, and returns the candidates ≥ 0.35. The pipeline detail
(clipboard item ordering, drag-drop, file drops) is specified in `03_UX.md` §6; this document owns
only the per-type matchers. Baseline matcher scores:

| Input                          | Winner                          | Score | Runner-up   |
| ------------------------------ | ------------------------------- | ----- | ----------- |
| `http(s)://…` single URL       | website                         | 0.95  | link 0.6    |
| URL matching an embed provider | embed                           | 0.9   | website 0.8 |
| `github.com/<owner>/<repo>`    | repository                      | 0.97  | website 0.8 |
| multiple URLs, one per line    | link ×N                         | 0.8   | –           |
| `user@host.tld`                | email                           | 0.95  | text 0.3    |
| bare domain (`example.com`)    | domain                          | 0.85  | link 0.5    |
| IPv4/IPv6 literal              | ip                              | 0.95  | text 0.2    |
| `@handle`                      | username                        | 0.8   | text 0.3    |
| image blob / `data:image/*`    | image                           | 0.99  | file 0.5    |
| other file blob                | file                            | 0.9   | –           |
| text with Markdown signals     | text (`format: rich`)           | 0.8   | sticky 0.4  |
| plain text ≤ 140 chars         | sticky                          | 0.6   | text 0.55   |
| plain text > 140 chars         | text                            | 0.85  | –           |
| `nexus/clipboard-v1` JSON      | (internal paste of nodes+edges) | 1.0   | –           |

Ties within 0.05 surface a paste chooser popover at the drop point (arrow keys + Enter), default
preselected; the choice is remembered per input class for the session.

---

## 8. Placement algorithm

`placeNodes(request: PlacementRequest): Placement[]` in `packages/domain/src/nodes/placement.ts`.
It must never overlap existing nodes and must be deterministic (same inputs → same output) so that
undo/redo and collaborative replay agree.

```text
Inputs:  boxes[]        desired w/h of the new nodes, in order
         anchor         {x,y} preferred position (cursor, drop point, or parent node)
         index          spatial index of existing nodes (05_CANVAS_ENGINE.md §4)
         viewport       current visible rect (canvas units)
         gap            24 (design token --space-6)
         mode           'cursor' | 'below-source' | 'grid' | 'radial'

Algorithm (mode = 'cursor' / 'below-source'):
1. candidate ← anchor, snapped to the 8-unit grid
2. for ring r = 0,1,2,… up to 24:
     for each offset in spiral(r):        // square spiral, step = gap + max(box.w, box.h)/2
        rect ← box at candidate + offset
        if not index.intersects(inflate(rect, gap)):
             accept rect; break
3. if no ring accepted (dense board): place at the first free slot scanning
   right-then-down from viewport top-left; if the viewport is full, place at
   (maxX + gap, anchor.y) where maxX is the board bounding-box right edge.
4. multiple boxes: after each acceptance, insert the rect into a temporary overlay
   index so subsequent boxes avoid it; lay out in a row while total width
   ≤ 3 × viewport.width, then wrap to a new row.
```

Complexity: the spiral visits `O(r²)` candidates; each `index.intersects` is an R-tree query at
`O(log n + k)`. In practice ≤ 40 probes per node on a 5,000-node board (measured budget: ≤ 1.2 ms
per node, enforced by `bench/placement.bench.ts`).

Mode specifics:

- `below-source`: anchor = `(source.x, source.y + source.h + gap)`, spiral biased downward (offsets
  with `dy > 0` are visited first). Used by "expand" actions so children appear under their parent.
- `grid`: pure row/column packing for bulk imports (≥ 8 nodes) inside a temporary `group` frame,
  6 columns, sorted by the caller's order. The frame is created in the same transaction so a single
  undo removes the whole import (N3).
- `radial`: for `expand-*` actions on a single source; children are placed on a circle of radius
  `max(220, 60 + n × 14)` starting at −90° and skipping angular sectors already occupied
  (checked with the same index query).

Post-placement: the camera does **not** move unless the placed set is entirely outside the
viewport, in which case a 240 ms eased pan brings its bounding box into view (reduced-motion → jump).

---

## 9. Node lifecycle

```text
              create ──► validate ──► place ──► [active]
                              │                    │
                        (invalid)                  ├─► enrich (async, §9.4)
                              ▼                    ├─► edit ──► version (§9.6)
                          rejected                 ├─► archive ──► restore
                                                   └─► delete (soft, 30 d) ──► purge (hard)
```

### 9.1 create

`createNode(type, partial, ctx)`:

1. `def = registry.get(type)`; unknown type → error `NODE_TYPE_UNKNOWN`.
2. Compose `{...EntityBase defaults, ...def.defaults, ...partial}`; generate ULID; set
   `createdAt = updatedAt = now`, `version = 1`, `status = 'draft'` while a creation dialog is open
   (otherwise `'active'`), `enrichment.state = 'idle'`.
3. `provenance` must be supplied by the caller. There is no default; the compile-time type requires it.
4. Validate (§9.2). Place (§8). Write inside one Yjs transaction with origin `'local:create'`.

### 9.2 validate

Two tiers:

- **Schema** (`def.schema.safeParse`) — hard. A node that fails schema validation is never written
  to the CRDT. On import, failing nodes are converted to `unknown` (§4.21) so nothing is lost.
- **Semantic** (`def.validate`) — soft. Returns `ValidationIssue[]` with
  `{ code, severity: 'error'|'warning', field, message, fix? }`. Errors block enrichment and tool
  actions but never block existence; warnings are informational. Issues are surfaced as an inline
  chip on the card and a list at the top of the inspector, each with its one-click `fix` when the
  definition provides one (e.g. `URL_MISSING_SCHEME` → prepend `https://`).

### 9.3 place

See §8. Placement happens before the node is visible; the node fades in over 120 ms
(reduced-motion → instant).

### 9.4 enrich — async state machine

```text
        ┌──────── requestEnrich() ────────┐
        ▼                                 │
 idle ──► queued ──► running ──► ready ───┘ (refresh)
   ▲        │           │  │
   │        │           │  └──► partial ──► (retry) ──► running
   │        │           └────► failed ──(backoff, ≤3)──► queued
   │        │                     │
   │        └── cancel ───────────┴──► idle
   └── ttlExpired ◄──── ready ──► stale ──(auto or manual)──► queued
```

Rules:

| Transition          | Trigger                                                                                               | Side effects                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `idle → queued`     | node created with enrichable data, or `Refresh` action                                                | job enqueued on BullMQ queue `enrich`, `jobId` stored                                            |
| `queued → running`  | worker picks the job                                                                                  | card shows loading state; `updatedAt` **not** bumped                                             |
| `running → ready`   | worker returns a complete payload                                                                     | fields patched in one transaction, origin `'remote:enrich'`; `version` bumped; success pulse     |
| `running → partial` | some sub-fetches failed (e.g. og image 404 but HTML ok)                                               | patch what succeeded, `lastError` holds the first failure                                        |
| `running → failed`  | fetch error, SSRF block, timeout (15 s default)                                                       | `attempts++`; retry with backoff 2 s / 10 s / 60 s ± 20% jitter; after 3 attempts stays `failed` |
| `ready → stale`     | `now - enrichment.updatedAt > ttl` (website 30 d, domain 7 d, repository 24 h, ip 7 d, username 14 d) | badge only; no automatic refetch (network calls are never implicit)                              |
| `* → idle`          | user cancels                                                                                          | job removed; partial data kept                                                                   |

Enrichment writes use origin `'remote:enrich'` and are therefore **excluded from the local undo
stack** (`08_DATA_MODEL.md` §2.5): the user cannot "undo" a background metadata fetch, which would
be confusing; they can `Clear enrichment` explicitly, which _is_ undoable. Enrichment never changes
`title` if the user has edited it (`titleEditedByUser` flag stored in `data._meta.titleLocked`,
set on the first manual title edit).

Concurrency: at most 4 concurrent enrichment jobs per board, 12 per user, enforced by BullMQ
group limits (`09_BACKEND.md` §6). All enrichment fetches go through the SSRF-guarded fetcher.

### 9.5 edit

Inline (L3) or inspector. Both write through `patchNode(id, patch, origin)` which:

1. Deep-merges the patch into the node `Y.Map` **key by key** (never wholesale replace — that would
   destroy concurrent edits to sibling keys).
2. Rich text is edited directly in the fragment by the editor binding; it never goes through `patch`.
3. Runs schema validation on the merged result _before_ committing; a failing patch is rejected with
   the field-level issue and the input reverts with a 120 ms shake.
4. Bumps `updatedAt`; bumps `version` per §9.6.
5. Text inputs debounce structural writes at 180 ms; the CRDT itself receives keystrokes immediately
   for text fragments (that is the point of Yjs), but _scalar_ fields debounce to keep update volume
   low.

### 9.6 version

`version` increments when: any `data` key changes, `title`/`tags`/`confidence` change, enrichment
completes, or a merge is applied. It does **not** increment on: move, resize, z-change, selection,
lock, color, star. This split matters because the projection (`08_DATA_MODEL.md` §5) uses `version`
as the idempotency key for content upserts while geometry updates are coalesced separately.

Every version bump appends a `HistoryEvent` (`08_DATA_MODEL.md` §6.1) containing the field-level
diff (JSON pointer → before/after, values truncated at 2 KB with a `truncated: true` marker).

### 9.7 archive

`status: 'archived'` hides the node from the canvas and from default search, keeps it in the CRDT
and in exports, and keeps its edges intact (edges to an archived node render at 20% opacity and are
skipped by graph algorithms unless `includeArchived` is set). Reversible in one click. Archiving a
group archives its children (recorded as one history event so one undo restores all).

### 9.8 delete / restore / purge

- `Delete` (Del) = **soft delete**: `deletedAt` timestamp set on the node map, node removed from the
  render set, edges marked `orphaned` but retained. Immediately undoable (N8), and listed in the
  board Trash for 30 days.
- Deleting a group asks: `Delete frame only` (children reparent to the board) vs `Delete frame and
contents`. Default is frame only.
- Restore from Trash restores geometry, parent (if the parent still exists, else board root) and
  edges whose other endpoint still exists.
- **Purge** (hard delete) happens on the 30-day sweep or by explicit `Delete permanently` in Trash;
  it removes the entry from the CRDT map, deletes the Postgres row (`08 §4.9` on-delete cascade for
  NodeTag/edges), and dereferences files (a File is purged when no node in any board references it
  and it is older than 24 h).

---

## 10. Duplicates and merging

### 10.1 Detection signals

`scoreDuplicate(a, b) → 0..1` combines weighted signals; the pair is a candidate at ≥ 0.62 and an
auto-suggested merge at ≥ 0.85. Only same-type pairs are compared, except the explicit cross-type
pairs `username ↔ person` and `domain ↔ organization`, which produce a _link_ suggestion, never a merge.

| Signal                           | Weight | Definition                                                                                                           |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| identity key equality            | 0.60   | any shared value from `def.identityKeys()` (exact, normalized)                                                       |
| URL equality after normalization | 0.20   | lowercase host, strip `www.`, strip trailing `/`, drop tracking params (`utm_*`, `fbclid`, `gclid`, `ref`, `mc_eid`) |
| title similarity                 | 0.12   | trigram Jaccard ≥ 0.72                                                                                               |
| content hash                     | 0.15   | sha256 of `File` bytes, or of normalized `plain` text                                                                |
| tag overlap                      | 0.05   | Jaccard of tag sets                                                                                                  |
| shared neighbors                 | 0.08   | Jaccard of adjacent node ids ≥ 0.5                                                                                   |
| temporal proximity               | 0.03   | `abs(observedAt delta) < 24 h`                                                                                       |
| same producing run               | −0.25  | two nodes from the same tool run are usually intentionally distinct                                                  |

The score is the weight sum clamped to `[0,1]`. Detection runs (a) incrementally on create/patch
against the identity index only (O(1) hash lookup), and (b) as a full pass in a Web Worker when the
user opens the Duplicates panel — pairwise comparison is limited to blocking buckets keyed by
`type + first identity key prefix + normalized title trigram bucket`, so it is O(n·b) with b ≤ 32,
not O(n²).

### 10.2 Merge UI contract

`MergePlan` is produced by the domain layer and rendered by a generic dialog; no type-specific UI.

```ts
interface MergePlan {
  survivorId: string; // default: oldest createdAt, or the one with more edges
  mergedIds: string[]; // 1..9 others
  fieldResolutions: Array<{
    path: string; // 'data.url', 'title', 'tags'
    strategy: 'survivor' | 'other' | 'union' | 'concat' | 'manual';
    chosenValue: unknown;
    conflicting: boolean;
  }>;
  edgeRewires: Array<{
    edgeId: string;
    action: 'rewire' | 'drop-duplicate' | 'keep';
    newEndpoint?: string;
  }>;
  provenance: { kind: 'derived'; source: 'merge'; mergedFrom: string[] };
  geometry: { x: number; y: number; w: number; h: number }; // survivor keeps its own
  warnings: string[];
}
```

Dialog contract: two/three-column diff, one row per differing field, radio per row, "union" preset
for arrays, live preview of the resulting card on the right, edge rewiring summary
("14 edges will move, 3 duplicates will be dropped"), and an explicit `Merge` button. Nothing is
merged without confirmation (N4/N8). The whole merge is one Yjs transaction ⇒ one Ctrl+Z reverses it.

### 10.3 Field resolution defaults

| Field kind                                                      | Default strategy                                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| scalar, equal                                                   | survivor                                                                                           |
| scalar, one empty                                               | non-empty value                                                                                    |
| scalar, both non-empty and different                            | **manual** (marked `conflicting`)                                                                  |
| arrays (`tags`, `aliases`, `usernames`, `emails`, `sourceUrls`) | union, deduped, order = survivor first                                                             |
| rich text fragments                                             | concat: survivor fragment, `---` rule, then each merged fragment under an H3 "Merged from {title}" |
| `confidence`                                                    | the **higher** of the two (confirmed > high > medium > low > unverified)                           |
| `provenance`                                                    | new `derived` provenance; originals preserved in `data._meta.mergedProvenance[]`                   |
| `createdAt`                                                     | earliest                                                                                           |
| files/media                                                     | survivor's; merged files become attachments listed in the inspector                                |

### 10.4 Edge rewiring rules

1. Every edge with an endpoint in `mergedIds` is rewired to `survivorId`.
2. After rewiring, an edge whose `source === target` (a self-loop created by the merge) is
   **dropped** unless its type is in the self-loop allowlist (`07_EDGE_SYSTEM.md` §7.5).
3. Two edges are duplicates when `(source, target, type, direction)` match. Keep the one with the
   higher confidence; if tied, the older; merge their provenance into
   `provenance.mergedFrom[]` and take the union of labels (joined with `; `, capped at 200 chars).
4. Manual waypoints on a dropped edge are lost; the dialog warns when this affects ≥1 edge.
5. All rewires happen in the same transaction as the merge.

### 10.5 Unmerge

A merge writes `data._meta.mergedFrom = [{id, snapshot}]` with the full pre-merge entity payloads
(capped at 64 KB total; above the cap the snapshots are stored as a `BoardSnapshot` reference
instead). `Unmerge` restores the original nodes with new positions (placed with mode `radial`
around the survivor) and re-splits edges by their recorded original endpoints. Unmerge is available
for 30 days or until the survivor is purged.

---

## 11. Type conversion and schema migration

- **Conversion** (`link → website`, `text → evidence`, `website → domain`, `sticky → text`) is a
  registered `TypeConversion { from, to, convert(node): node }` in
  `packages/domain/src/nodes/conversions.ts`. Conversions preserve `id`, geometry, tags, edges and
  provenance (adding `kind: 'derived', source: 'convert:<from>-><to>'`). Lossy conversions list the
  dropped fields in the confirm dialog.
- **Schema versioning**: each definition may export `migrations: Record<number, (data) => data>` and
  `dataVersion: number`. On load, any node with `data._v < dataVersion` is migrated in memory and
  written back lazily on the next edit (not eagerly, to avoid rewriting a whole board on open).
  Board-level format migration lives in `08_DATA_MODEL.md` §8.6.
- `type` strings are never renamed. A deprecated type keeps its definition, marked
  `deprecated: true`, so old boards keep rendering and only the create menu hides it.

---

## 12. Open risks

1. **TipTap/y-prosemirror version coupling.** The binding is the only mature option but ties us to
   ProseMirror's release cadence. Mitigation: rich text access is behind `packages/domain/richtext`
   with `fragmentToHtml` / `htmlToFragment` as the only public surface, so the editor can be
   replaced without touching node definitions. Validate on upgrade with the Markdown round-trip
   property test.
2. **OPFS quota behavior varies by browser and is not contractual.** A user can lose the local
   cache at any time. Mitigation: OPFS is a cache plus an upload staging area only; nothing is
   authoritative there once `File.state='synced'`. The `Local only` chip makes the risk visible.
3. **Auto font sizing on stickies is O(log n) per resize but runs on the main thread.** If a
   bulk resize of >200 stickies is ever added, this must move to a worker with measured text.
4. **Duplicate blocking buckets can miss cross-language or transliterated identities** (e.g.
   Cyrillic vs Latin handles). Mitigation: NFKC + a confusable-skeleton key is included in
   `identityKeys` for `username`/`person`; still not exhaustive — the Duplicates panel therefore
   also offers a manual "compare selected" action.
5. **EXIF preservation vs privacy.** Keeping originals EXIF-intact is right for evidence integrity
   but risky when a board is shared. Mitigation: share links and exports strip EXIF by default and
   the export dialog states it; a workspace admin can force strip-on-upload.
6. **`unknown` node round-trip depends on the CRDT preserving unrecognized keys.** If a future
   client ever normalizes maps aggressively, plugin data could be dropped. Guarded by an explicit
   round-trip test with a synthetic unknown type in `packages/domain/test/unknown.spec.ts`.
7. **Rotation is deliberately unsupported.** If product later demands it, hit-testing, the DOM
   overlay transform and edge clipping (`07_EDGE_SYSTEM.md` §7.4) all need rework; the `rotation`
   field is reserved now so the schema does not have to change then.
