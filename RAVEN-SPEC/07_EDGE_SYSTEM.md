# 07 — EDGE SYSTEM

## Scope

Defines the relationship layer of Raven: the edge data model, the typed relationship taxonomy
(22 built-in types with endpoint constraints), the creation and editing UX contract, the four
routing algorithms with pseudocode and complexity, label placement, arrowheads and clipping,
waypoint editing with manual override, canvas rendering and hit-testing, and the performance rules
that keep 10,000 edges inside the frame budget of `00_MASTER.md` N1. Node semantics are in
`06_NODE_SYSTEM.md`; renderer/camera internals in `05_CANVAS_ENGINE.md`; persistence in
`08_DATA_MODEL.md`.

---

## 1. Principles

1. **An edge is a claim, not a line.** It carries a type, a direction, confidence, provenance and
   temporal validity, exactly like a node (`00_MASTER.md` §3.4).
2. **Edges are always canvas.** No edge is ever a DOM or SVG element, at any zoom. This is what
   makes 10,000 edges affordable (`05_CANVAS_ENGINE.md` §2).
3. **Geometry is derived and cached; semantics are stored.** Only endpoints, type, style overrides
   and _manual_ waypoints are in the document. Everything else (routed path, label box, clip
   points) is recomputed and cached.
4. **Manual beats automatic.** Once a user drags a waypoint, routing never overwrites it; it only
   transforms it (§8.3).

---

## 2. Data model

```ts
// packages/domain/src/edges/schema.ts
import { z } from 'zod';
import { Confidence, Provenance } from '../nodes/base';

export const EdgeEndpoint = z.object({
  nodeId: z.string().ulid(),
  /** which side the edge leaves/enters; 'auto' lets the router choose (§7.1) */
  port: z.enum(['auto', 'top', 'right', 'bottom', 'left']).default('auto'),
  /** 0..1 position along that side; 0.5 = center. Only meaningful when port !== 'auto' */
  offset: z.number().min(0).max(1).default(0.5),
  /** anchor to a sub-part of a node (list row, table cell) — reserved, always null in v1 */
  anchorKey: z.string().max(64).nullable().default(null),
});

export const Waypoint = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  /** relative anchoring so the point survives node movement (§8.3) */
  rel: z.object({
    base: z.enum(['source', 'target', 'midpoint', 'absolute']),
    dx: z.number(),
    dy: z.number(),
  }),
});

export const EdgeStyle = z.object({
  routing: z.enum(['smart', 'curved', 'orthogonal', 'straight']).nullable().default(null), // null = type default
  stroke: z
    .string()
    .regex(/^--edge-[a-z0-9-]+$/)
    .nullable()
    .default(null),
  width: z.number().min(0.5).max(8).nullable().default(null),
  dash: z.enum(['solid', 'dashed', 'dotted', 'dash-dot']).nullable().default(null),
  arrowSource: z
    .enum(['none', 'arrow', 'hollow', 'dot', 'diamond', 'tee'])
    .nullable()
    .default(null),
  arrowTarget: z
    .enum(['none', 'arrow', 'hollow', 'dot', 'diamond', 'tee'])
    .nullable()
    .default(null),
  animated: z.boolean().nullable().default(null),
  labelPosition: z.number().min(0).max(1).default(0.5), // t along the path
  labelOffset: z.object({ dx: z.number(), dy: z.number() }).default({ dx: 0, dy: 0 }),
  curvature: z.number().min(0).max(1).nullable().default(null), // bezier tension override
  cornerRadius: z.number().min(0).max(40).nullable().default(null), // orthogonal corners
  zBias: z.number().int().min(-5).max(5).default(0),
});

export const Edge = z.object({
  id: z.string().ulid(),
  type: z.string().min(1).max(48), // relationship type id (§3)
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  directed: z.boolean(), // from the type default, user-overridable
  label: z.string().max(200).default(''),
  description: z.string().max(2000).nullable().default(null),
  confidence: Confidence.default('unverified'),
  weight: z.number().min(0).max(1).default(0.5), // strength/importance; drives width + layout
  provenance: Provenance,
  /** temporal validity */
  observedAt: z.string().datetime(), // when the relationship was observed
  validFrom: z.string().datetime().nullable(), // when it started being true
  validTo: z.string().datetime().nullable(), // when it stopped being true (null = still true)
  tags: z.array(z.string().max(48)).max(32).default([]),
  waypoints: z.array(Waypoint).max(24).default([]),
  manualRoute: z.boolean().default(false), // true once the user edits waypoints
  style: EdgeStyle,
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  status: z.enum(['active', 'archived']).default('active'),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().min(1),
  data: z.record(z.string(), z.unknown()).default({}), // type-specific extras (§3.3)
});
export type Edge = z.infer<typeof Edge>;
```

### 2.1 Direction

`directed` comes from the relationship type default and may be flipped per edge. Semantics:

- `directed: true` → the edge asserts `source —type→ target`; renders `arrowTarget: 'arrow'` by
  default; graph algorithms traverse it forward, and backward only when explicitly asked.
- `directed: false` → symmetric assertion; both arrowheads `none`; `source`/`target` are still
  stored (a CRDT needs a canonical order) but the domain layer normalizes undirected edges so that
  `source.nodeId < target.nodeId` lexicographically. This makes duplicate detection trivial and
  prevents two clients from creating mirrored twins offline.

### 2.2 Temporal validity

Three timestamps with distinct meaning, all optional except `observedAt`:

| Field        | Meaning                                         | Example                           |
| ------------ | ----------------------------------------------- | --------------------------------- |
| `observedAt` | when _we_ saw the evidence for the relationship | Sherlock run at 2026-08-17T10:03Z |
| `validFrom`  | when the relationship began in the real world   | employment start 2019-04-01       |
| `validTo`    | when it ended; `null` = ongoing                 | employment end 2023-11-30         |

Check constraint: `validTo === null || validFrom === null || validTo >= validFrom`
(`TIME_RANGE_INVERTED`). The timeline view filters edges by these fields; an edge with
`validTo < now` renders with 55% opacity and a small `past` badge on the label at L2+.

### 2.3 Weight and confidence

- `confidence` is the analyst's belief in the _claim_. It maps to opacity: confirmed 1.0, high 0.92,
  medium 0.78, low 0.6, unverified 0.45, and to dash: `unverified`/`low` → `dashed` unless the type
  or the user overrides.
- `weight` is importance, not belief. It maps to stroke width `1 + weight × 2` px (device-independent,
  divided by zoom so lines keep constant screen width, clamped to `[0.75, 4]` px on screen), and it
  is the edge weight used by force layout and pathfinding (`14 views` / auto-layout).

---

## 3. Relationship taxonomy

### 3.1 Registry

```ts
export interface EdgeTypeDefinition {
  type: string; // stable id, never renamed
  label: string; // 'works at'
  inverseLabel: string; // 'employs' — shown when reading the edge backwards
  category:
    | 'identity'
    | 'social'
    | 'infrastructure'
    | 'code'
    | 'reasoning'
    | 'structural'
    | 'temporal';
  directed: boolean;
  strokeToken: string; // '--edge-identity'
  dash: 'solid' | 'dashed' | 'dotted' | 'dash-dot';
  arrowTarget: 'none' | 'arrow' | 'hollow' | 'dot' | 'diamond' | 'tee';
  arrowSource: 'none' | 'arrow' | 'hollow' | 'dot' | 'diamond' | 'tee';
  defaultRouting: 'smart' | 'curved' | 'orthogonal' | 'straight';
  animated: boolean;
  allowSelfLoop: boolean;
  /** endpoint constraint: '*' means any node type */
  allowed: Array<{ source: string[]; target: string[] }>;
  /** suggestion score for a candidate (source,target) pair, 0..1 (§5.3) */
  suggest(sourceType: string, targetType: string, ctx: SuggestContext): number;
  /** extra type-specific fields validated against edge.data */
  dataSchema?: z.ZodType<Record<string, unknown>>;
  /** side effects on connect/disconnect, e.g. hypothesis counters */
  onAttach?(edge: Edge, ctx: GraphContext): void;
  onDetach?(edge: Edge, ctx: GraphContext): void;
}
export const EdgeTypeRegistry = { register, get, list, has }; // same contract as node registry
```

Same extensibility rule as nodes: no engine or UI file switches on `edge.type`; plugins register
new relationship types through `17_PLUGIN_SDK.md` §4.

### 3.2 Built-in relationship types

`*` = any node type. Node type ids are those of `06_NODE_SYSTEM.md` §4.

| #   | type                | label / inverse                       | dir | allowed source → target                                     | style                                   | routing    | category       |
| --- | ------------------- | ------------------------------------- | --- | ----------------------------------------------------------- | --------------------------------------- | ---------- | -------------- |
| 1   | `references`        | references / referenced by            | ✓   | `*` → `*`                                                   | `--edge-neutral`, solid, 1.5 px, arrow  | smart      | structural     |
| 2   | `derived_from`      | derived from / produced               | ✓   | `*` → `*`                                                   | `--edge-derived`, dashed, animated      | curved     | structural     |
| 3   | `same_as`           | same as / same as                     | ✗   | same-type pairs only                                        | `--edge-identity`, solid, 2 px, dot–dot | straight   | identity       |
| 4   | `alias_of`          | alias of / has alias                  | ✓   | `username,person,organization,domain` → same                | `--edge-identity`, dash-dot             | curved     | identity       |
| 5   | `has_account`       | has account / belongs to              | ✓   | `person,organization` → `username,email`                    | `--edge-identity`, solid, arrow         | smart      | identity       |
| 6   | `owns`              | owns / owned by                       | ✓   | `person,organization` → `domain,ip,repository,file,website` | `--edge-infra`, solid, diamond source   | smart      | infrastructure |
| 7   | `member_of`         | member of / has member                | ✓   | `person` → `organization,group`                             | `--edge-social`, solid, hollow arrow    | curved     | social         |
| 8   | `works_at`          | works at / employs                    | ✓   | `person` → `organization`                                   | `--edge-social`, solid, arrow           | curved     | social         |
| 9   | `knows`             | knows / knows                         | ✗   | `person` → `person`                                         | `--edge-social`, solid, 1.25 px         | curved     | social         |
| 10  | `communicates_with` | communicates with / communicates with | ✗   | `person,username,email` → same                              | `--edge-social`, dotted                 | curved     | social         |
| 11  | `resolves_to`       | resolves to / resolved from           | ✓   | `domain` → `ip`; `domain` → `domain` (CNAME)                | `--edge-infra`, solid, arrow            | orthogonal | infrastructure |
| 12  | `hosted_on`         | hosted on / hosts                     | ✓   | `website,domain,repository` → `ip,organization`             | `--edge-infra`, solid, arrow            | orthogonal | infrastructure |
| 13  | `part_of`           | part of / contains                    | ✓   | `*` → `domain,organization,group,repository`                | `--edge-structure`, solid, tee          | orthogonal | structural     |
| 14  | `contributed_to`    | contributed to / has contributor      | ✓   | `person,username,organization` → `repository`               | `--edge-code`, solid, arrow             | smart      | code           |
| 15  | `depends_on`        | depends on / is dependency of         | ✓   | `repository` → `repository`                                 | `--edge-code`, dashed, arrow            | orthogonal | code           |
| 16  | `forked_from`       | forked from / has fork                | ✓   | `repository` → `repository`                                 | `--edge-code`, solid, hollow            | curved     | code           |
| 17  | `mentions`          | mentions / mentioned in               | ✓   | `text,evidence,website,file,repository` → `*`               | `--edge-neutral`, dotted                | curved     | structural     |
| 18  | `supports`          | supports / supported by               | ✓   | `evidence,text,tool-result,file,website` → `hypothesis`     | `--edge-positive`, solid, arrow         | curved     | reasoning      |
| 19  | `contradicts`       | contradicts / contradicted by         | ✓   | `evidence,text,tool-result,file,website` → `hypothesis`     | `--edge-danger`, solid, tee             | curved     | reasoning      |
| 20  | `caused_by`         | caused by / caused                    | ✓   | `timeline-event,*` → `timeline-event,*`                     | `--edge-time`, solid, arrow             | smart      | temporal       |
| 21  | `precedes`          | precedes / follows                    | ✓   | `timeline-event` → `timeline-event`                         | `--edge-time`, dashed, arrow            | orthogonal | temporal       |
| 22  | `located_at`        | located at / location of              | ✓   | `person,organization,ip,timeline-event,image` → `location`  | `--edge-geo`, solid, dot                | curved     | infrastructure |

Notes on semantics that are easy to get wrong:

- `same_as` merges _identity_, `alias_of` does not. `same_as` between two nodes is the strongest
  duplicate signal and the Duplicates panel (`06_NODE_SYSTEM.md` §10) offers a merge whenever one
  exists.
- `derived_from` always points **from the derived node to its origin** (`nodeCreated → source`).
  It is the only animated type by default (§10.4) because it is what makes a tool import legible.
- `part_of` is the semantic containment relationship and is independent of the geometric
  `parentId` grouping in `06_NODE_SYSTEM.md` §4.16. Placing a node in a frame does **not** create a
  `part_of` edge; the frame offers it as a suggestion chip.
- `supports`/`contradicts` mutate `hypothesis.data.supportCount/contradictCount` through
  `onAttach`/`onDetach` inside the same transaction.

### 3.3 Type-specific `data`

| type                       | `data` fields                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `resolves_to`              | `{ recordType: 'A'\|'AAAA'\|'CNAME', ttl: number \| null }`                                                                             |
| `contributed_to`           | `{ commits: number \| null, firstCommitAt: string \| null, lastCommitAt: string \| null, role: 'author'\|'maintainer'\|'contributor' }` |
| `depends_on`               | `{ ecosystem: string, versionRange: string \| null, scope: 'runtime'\|'dev'\|'peer' }`                                                  |
| `works_at` / `member_of`   | `{ role: string \| null }`                                                                                                              |
| `has_account`              | `{ verificationMethod: 'manual'\|'tool'\|'self-declared', verified: boolean }`                                                          |
| `supports` / `contradicts` | `{ strength: 'weak'\|'moderate'\|'strong' }`                                                                                            |
| `communicates_with`        | `{ channel: string \| null, messageCount: number \| null }`                                                                             |
| all others                 | `{}`                                                                                                                                    |

### 3.4 Endpoint validation

```ts
function validateEndpoints(type: string, src: NodeLike, dst: NodeLike): ValidationIssue[];
```

- If the pair is not in `allowed`, the result is a **warning**, not an error: the edge is created
  with `confidence` forced to `unverified` and the inspector shows "Unusual relationship for these
  node types". Rationale: OSINT graphs regularly need relationships the taxonomy did not
  anticipate; blocking them would push users to `references` and destroy the semantics.
- Self-loops are rejected unless `allowSelfLoop` (true only for `references`, `mentions`,
  `communicates_with`, `knows`). Rejection surfaces as a 120 ms shake on the drop target.
- Duplicate edges (`source`, `target`, `type`, `directed` all equal, both `status: 'active'`) are
  rejected with a toast offering `Open existing edge` — which selects it and pans it into view.
- Edges to/from a `group` node are allowed only when the group is `kind: 'cluster'`; `frame` groups
  are pure geometry.

---

## 4. Rendering model

### 4.1 Frame pipeline

Per frame, the edge layer does exactly this (`05_CANVAS_ENGINE.md` §6 owns the surrounding loop):

```text
1. viewportEdges ← spatialIndex.queryEdges(expandedViewport)      // R-tree over edge bounding boxes
2. for each edge in viewportEdges (sorted by zBias, then type category, then id):
     geom ← routeCache.get(key(edge))  ??  route(edge)            // §7
     if geom.dirty: geom ← route(edge)
     drawEdge(ctx, geom, styleFor(edge, theme, lod))
3. draw arrowheads (batched by style into a single path per style bucket)
4. draw labels (only when lod ≥ L1 and label box passes the overlap filter, §9)
5. draw interaction affordances for the hovered/selected edge only
```

Batching rule: all edges sharing `(strokeToken, width, dash, alpha bucket)` are accumulated into one
`Path2D` and stroked once. Alpha is bucketed into 5 steps (1.0/0.92/0.78/0.6/0.45) so confidence
does not explode the bucket count. On a 10,000-edge board this collapses to ≤ 40 stroke calls.

### 4.2 LOD

| Level | Zoom        | Edge rendering                                                                                                                                                             |
| ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0    | `< 0.28`    | 1 px straight line between node centers, `--edge-far` at 35% alpha, no arrowheads, no labels; edges shorter than 6 px on screen are skipped entirely                       |
| L1    | `0.28–0.55` | real routing but at reduced fidelity: bezier flattened with 8 segments, arrowheads only for `directed` edges longer than 24 px on screen, labels only for selected/hovered |
| L2    | `0.55–1.6`  | full routing, arrowheads, labels for edges longer than 60 px on screen                                                                                                     |
| L3    | `≥ 1.6`     | full routing, labels always, waypoint handles on selection, hover hit area widened                                                                                         |

### 4.3 Path construction

All routing modes emit a common structure so drawing and hit-testing are mode-agnostic:

```ts
interface EdgeGeometry {
  kind: 'line' | 'bezier' | 'poly';
  /** flattened polyline in canvas units, used for hit-testing, labels and arrow angles */
  flat: Float32Array; // [x0,y0,x1,y1,…]
  /** exact drawing commands */
  cmds: Array<
    | { t: 'M'; x: number; y: number }
    | { t: 'L'; x: number; y: number }
    | { t: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { t: 'Q'; x1: number; y1: number; x: number; y: number }
  >;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  length: number;
  startPoint: { x: number; y: number; angle: number }; // after clipping (§7.4)
  endPoint: { x: number; y: number; angle: number };
  labelAnchor: { x: number; y: number; angle: number };
  revision: number; // increments on every recompute
}
```

`flat` is built once with adaptive subdivision (max deviation 0.35 canvas units, cap 64 segments)
and reused for hit-testing, label placement, arrow angles and the bounding box. It is stored in a
pooled `Float32Array` allocated from a slab allocator to avoid GC churn (`16_PERFORMANCE.md` §4).

---

## 5. Creation UX contract

### 5.1 Handles

- At L2+, hovering a node shows 4 connection handles (top/right/bottom/left), 12×12 px hit area,
  8×8 px visual, `--accent-muted`, appearing over 90 ms. At L3 the handles are always visible for
  the selected node.
- Pointer-down on a handle starts a connect drag: a live "ghost" edge is routed with the current
  default routing mode from that handle to the cursor, drawn with `--accent` at 70% alpha.
- Valid drop targets highlight (2 px `--accent` ring) as the cursor enters them; the whole node is a
  drop target, not just its handles. The target's best port is chosen live by §7.1 and previewed.
- Invalid targets (self, `connectable: false`, locked) show a `not-allowed` cursor and no ring.
- Dropping on empty canvas opens the **quick-create menu** at the cursor: a filtered list of node
  types (ranked by `edgeAffinity` of the source type), plus "Paste from clipboard". Choosing a type
  creates the node at the drop point and the edge in one transaction (one Ctrl+Z removes both).
- Esc during the drag cancels; the ghost fades over 90 ms.

### 5.2 Connect by selection and keyboard

| Input                             | Behavior                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Select exactly 2 nodes, press `E` | creates the suggested edge type (§5.3) from the first-selected to the second                                            |
| Select N > 2 nodes, press `E`     | opens the connect dialog: `chain` (1→2→3…), `star from first`, `star to first`, `mesh` (all pairs, capped at 200 edges) |
| Select 2 nodes, `Shift+E`         | opens the type picker instead of using the suggestion                                                                   |
| Edge selected, `R`                | reverse direction (swaps endpoints, keeps waypoints mirrored)                                                           |
| Edge selected, `T`                | cycle routing mode smart → curved → orthogonal → straight                                                               |
| Edge selected, `L`                | focus the label editor inline                                                                                           |
| Edge selected, `Backspace/Del`    | soft delete (undoable)                                                                                                  |
| Node focused, `Tab`               | move focus along outgoing edges (accessibility traversal, N6)                                                           |
| Node focused, `Shift+Tab`         | move focus along incoming edges                                                                                         |
| During connect drag, `1`–`9`      | force the relationship type by its rank in the suggestion list                                                          |
| During connect drag, hold `Alt`   | force `port` to the side under the cursor instead of `auto`                                                             |
| During connect drag, hold `Shift` | constrain the ghost to 0/45/90°                                                                                         |

Keyboard-only creation path (no pointer required, N6): focus a node → `E` → a target picker opens
(fuzzy search over board nodes) → Enter → type picker (pre-ranked) → Enter. Every step is
announced through an `aria-live="polite"` region.

### 5.3 Type suggestion

```text
suggestEdgeType(srcType, dstType, ctx) -> ranked list
score(def) =
    0.55 * (pair ∈ def.allowed ? 1 : 0)
  + 0.20 * normalizedFrequency(def.type, ctx.projectHistogram)   // what this project uses
  + 0.15 * def.suggest(srcType, dstType, ctx)                    // type-specific heuristic
  + 0.10 * (def.category === ctx.lastUsedCategory ? 1 : 0)
```

`ctx.projectHistogram` is maintained per project in Postgres (`SavedSearch`-adjacent counters, see
`08_DATA_MODEL.md` §4.24) and cached client-side. Fallback when everything is 0: `references`.
The top suggestion is applied on plain `E`/drop; the full ranked list is what the picker shows,
with the top item preselected and its `inverseLabel` shown as a hint ("person **works at** org /
org employs person").

### 5.4 Edge creation states

| State              | Visual                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ |
| idle               | handles hidden (L2) or shown for selection (L3)                                            |
| handle-hover       | handle grows to 10×10, `--accent`                                                          |
| dragging           | ghost path, cursor `crosshair`, source handle pinned                                       |
| valid-target       | target ring, ghost snaps to the computed port, label preview chip shows the suggested type |
| invalid-target     | no ring, `not-allowed` cursor, ghost turns `--text-muted`                                  |
| dropped-empty      | quick-create menu at cursor                                                                |
| created            | 180 ms draw-on animation (dash offset from `length` → 0); reduced-motion → instant         |
| duplicate-rejected | 120 ms shake on the existing edge + toast with `Open existing edge`                        |
| error              | toast: what/why/what to do (`03_UX.md` §12)                                                |

---

## 6. Editing

- **Select**: click within 8 px (screen) of the path; the whole edge highlights with a 2 px
  `--accent` stroke plus a 6 px `--accent` at 18% alpha halo.
- **Label**: double-click on the label (or on the path midpoint when there is no label) opens an
  inline single-line input anchored to `labelAnchor`; Enter commits, Esc reverts. Empty label
  removes the label chip.
- **Waypoints** (L3, selected edge): each existing waypoint is a 8×8 px square handle; the midpoint
  of each segment shows a 6×6 px "virtual" handle that materializes into a real waypoint on drag.
  Alt+click a waypoint deletes it. Dragging any waypoint sets `manualRoute = true`.
- **Endpoint re-attach**: the two endpoint handles (10×10 px circles) can be dragged onto another
  node; the same validity rules as §5.1 apply. Dropping on empty canvas cancels (edges never dangle).
- **Bend on drag**: dragging the path body of a `curved` edge inserts a waypoint at the grab
  position and starts dragging it (matches user expectation from diagram tools).
- **Reset routing**: `Ctrl+Shift+R` on selected edges clears `waypoints` and `manualRoute`, with an
  undo entry.
- **Multi-edit**: with N edges selected, the inspector shows shared fields; mixed values render as
  "—" and only write when touched.

---

## 7. Routing algorithms

All routing runs in `packages/domain/src/edges/routing/` as pure functions
`route(input: RouteInput): EdgeGeometry`, with no DOM and no React, so the same code runs on the
main thread and inside the routing worker (§11.2).

```ts
interface RouteInput {
  source: NodeBox;
  target: NodeBox; // {x,y,w,h,shape}
  srcPort: Port;
  dstPort: Port; // resolved ports (§7.1)
  waypoints: Waypoint[];
  manualRoute: boolean;
  mode: 'straight' | 'curved' | 'orthogonal' | 'smart';
  siblingIndex: number;
  siblingCount: number; // multi-edge separation (§7.6)
  obstacles?: ObstacleGrid; // only for orthogonal
  curvature: number;
  cornerRadius: number;
}
```

### 7.1 Port resolution (`port: 'auto'`)

```text
resolvePort(self, other, mode):
  d ← center(other) − center(self)
  if mode = 'orthogonal':
      choose the side whose outward normal has the largest dot product with d,
      breaking ties horizontally (right/left) because cards are wider than tall
  else:
      # allow diagonal exits for curved/straight: pick the side, then the offset along it
      side ← argmax(dot(normal_s, d))
      offset ← clamp(0.5 + (perpendicular component of d) / (2 · sideLength), 0.15, 0.85)
  return {side, offset}
```

Hysteresis: when a node is being dragged, the chosen side only flips when the dot-product margin
exceeds 0.12. Without it, edges flicker between sides while dragging past a diagonal.

### 7.2 Straight

```text
route_straight:
  p0 ← portPoint(source, srcPort);  p1 ← portPoint(target, dstPort)
  if waypoints: polyline p0 → w1 → … → wn → p1
  clip both ends to node borders (§7.4)
  apply sibling offset perpendicular to (p1−p0) (§7.6)
```

Complexity O(w). Used for `same_as` and for any edge below 40 screen px (any mode degrades to
straight at that length — curves are invisible and cost cycles).

### 7.3 Curved (cubic bezier with endpoint normals)

```text
route_curved:
  p0, p1 ← port points;  n0, n1 ← outward unit normals of the chosen ports
  dist ← |p1 − p0|
  k    ← clamp(dist * curvature, 24, 220)          # curvature default 0.35
  # normals guarantee the line leaves and enters perpendicular to the card edge,
  # which is what makes a dense graph readable
  c0 ← p0 + n0 * k
  c1 ← p1 + n1 * k
  if waypoints.length = 0:
      cmds ← [M p0, C c0 c1 p1]
  else:
      # Catmull-Rom through [p0, w…, p1] converted to cubic beziers, tension 0.5,
      # with the first and last tangents forced to n0 / −n1 so the endpoint normals hold
      cmds ← catmullRomToBezier([p0, ...waypoints, p1], tension=0.5, t0=n0, t1=-n1)
  flatten adaptively (deviation ≤ 0.35 units, ≤ 64 segments at L2+, ≤ 8 at L1)
```

Complexity O(w) plus O(s) flattening. Self-adjusting: when the two ports face each other and
`dist < 2k`, `k` is reduced to `dist/2` to avoid the classic "S-loop overshoot".

### 7.4 Endpoint clipping and arrowheads

```text
clipToBorder(point p_inside_path, box, shape):
  # walk the flattened polyline from the endpoint inward until the first sample
  # outside the inflated box; then binary-search 6 iterations for the exact crossing
  target inflation = 2 units (visual gap between card border and line)
  for rect shapes: analytic ray-box intersection (Liang–Barsky), no search needed
  for rounded rects (all Raven cards, radius from --radius-card): analytic on the
      straight segments, and circle intersection on the corner arcs
  returns {x, y, angle} where angle = atan2 of the tangent at the crossing
```

Arrowheads are drawn at `endPoint` (and `startPoint` when `arrowSource !== 'none'`), rotated by the
tangent angle, in screen space (size does not scale with zoom): `arrow` = filled triangle 9×7 px,
`hollow` = same outline 1.25 px, `dot` = r 3.5 px filled, `diamond` = 8×8 px, `tee` = 8 px bar
perpendicular to the tangent. The path is shortened by the arrowhead length so the stroke does not
poke through the tip.

### 7.5 Self-loops

For `source.nodeId === target.nodeId` (only for types with `allowSelfLoop`):

```text
route_selfloop(box, index):
  side  ← ['right','top','left','bottom'][index mod 4]
  r     ← 34 + floor(index / 4) * 18          # concentric loops for multiple self-edges
  p0    ← point at 35% along `side`;  p1 ← point at 65% along `side`
  n     ← outward normal of `side`
  cmds  ← [M p0, C p0 + n*r*1.4 + t*(-r*0.4), p1 + n*r*1.4 + t*(r*0.4), p1]
          where t is the tangent (along the side)
  label anchored at the loop apex (p0 + p1)/2 + n*r*1.05
```

### 7.6 Multi-edge separation

Edges sharing the same unordered node pair are grouped and offset so they never overlap.

```text
separate(pairKey, edges):
  edges sorted by (type, id) for stability   # deterministic across clients
  n ← edges.length
  for i in 0..n-1:
      k ← i − (n − 1) / 2                    # symmetric around 0: -1,0,1 / -1.5,-0.5,0.5,1.5
      offset ← k * SEP                       # SEP = 18 canvas units
      curved:      shift both control points by offset * perpendicular(p1 − p0)
                   and shift the midpoint of the bezier by 2 * offset (visual separation
                   is dominated by the mid-curve, not the controls)
      straight:    offset the whole segment perpendicular; endpoints are re-clipped
      orthogonal:  shift the shared trunk lane by offset (§7.7 lane assignment)
```

For `n > 7` the edges are **bundled**: they are drawn as one thicker path (width
`1.5 + log2(n)` px) with an `n` count chip at the midpoint; clicking it expands the bundle
(temporarily setting `SEP = 12` and drawing all members) until the selection changes. Bundling is
computed once per pair per invalidation and cached with the pair key.

### 7.7 Orthogonal (A\* on a sparse visibility grid)

Only orthogonal routing needs obstacle avoidance. The grid is **sparse** and built from the node
spatial index, not a dense raster — a dense grid over an infinite canvas is not affordable.

```text
buildObstacleGrid(region, index):
  boxes ← index.query(region)                      # nodes intersecting the routing region
  inflate each box by CLEARANCE = 12 units
  xs ← sorted unique { box.left, box.right,  p0.x, p1.x, region.left, region.right }
  ys ← sorted unique { box.top,  box.bottom, p0.y, p1.y, region.top,  region.bottom }
  # Hanan grid: |xs| × |ys| lattice; a cell/edge is blocked if it lies inside an inflated box
  return {xs, ys, blocked: bitset}

route_orthogonal(p0, n0, p1, n1, grid):
  # nodes of the search are lattice points; moves are axis-aligned to the 4 neighbours
  start ← lattice point nearest to (p0 + n0 * CLEARANCE)
  goal  ← lattice point nearest to (p1 + n1 * CLEARANCE)
  g(start) = 0
  h(v)   = |v.x − goal.x| + |v.y − goal.y|                    # Manhattan, admissible
  cost(u→v) = euclid(u,v)
            + (turn ? TURN_PENALTY : 0)                        # TURN_PENALTY = 30
            + (laneOccupied(segment) ? LANE_PENALTY : 0)       # LANE_PENALTY = 8
            + (crossesEdge(segment) ? CROSS_PENALTY : 0)       # CROSS_PENALTY = 4
  A* with a binary heap; expand until goal or budget exhausted
  budget: 4000 expansions or 6 ms, whichever first
  on exhaustion → fall back to the 3-segment "Z" route (see below) and mark geom.degraded = true
  post-process:
     1. collapse collinear points
     2. simplify: remove a point if removing it keeps the path clear (2 passes)
     3. snap segments to shared lanes (multiples of 6 units) so parallel edges align
     4. round corners with cornerRadius (default 8) using quadratic curves
```

Z-fallback (also used when there are no obstacles between the endpoints, which the router checks
first with a single index query — the common case, and it costs O(log n)):

```text
if ports are opposite horizontally: [p0, (mx,p0.y), (mx,p1.y), p1]   where mx = (p0.x+p1.x)/2
if ports are opposite vertically:   [p0, (p0.x,my), (p1.x,my), p1]   where my = (p0.y+p1.y)/2
otherwise (L-shape):                [p0, (p1.x,p0.y) or (p0.x,p1.y), p1]  choosing the
                                    variant whose corner is not inside an obstacle
```

Complexity: grid build `O(m log m)` for `m` nearby boxes (typically m ≤ 60 because the region is
the endpoint bounding box inflated by 240 units); A\* is `O(V log V)` on a lattice of
`|xs| × |ys| ≤ 130 × 130` in the worst case, bounded by the expansion budget. Measured budget:
p95 ≤ 2.1 ms per edge on a 5,000-node board (`bench/routing.bench.ts`).

### 7.8 Smart (heuristic chooser)

```text
route_smart(edge, src, dst, index):
  d        ← |center(dst) − center(src)|
  aligned  ← |Δx| < 24 or |Δy| < 24
  obstacles← index.countIntersecting(segmentBBox(src, dst)) − 2      # minus the endpoints
  if d < 40                        → straight
  else if aligned and obstacles=0  → straight
  else if obstacles = 0            → curved
  else if obstacles ≤ 2 and category ∈ {infrastructure, code, temporal}
                                   → orthogonal
  else if obstacles ≤ 2            → curved with a single auto-waypoint placed at the
                                     midpoint pushed perpendicular by 40 + 12·obstacles
                                     away from the densest side (auto-waypoints are NOT
                                     stored; they are part of the cached geometry)
  else                             → orthogonal
```

The chosen mode is stored in the geometry cache, not in the document, so the same edge can render
differently as the board changes — which is the point of "smart". The inspector shows the resolved
mode as a read-only hint next to the mode selector.

---

## 8. Invalidation and manual override

### 8.1 Cache keys

```text
routeKey(edge) = edge.id + ':' + edge.version + ':' +
                 srcGeomHash + ':' + dstGeomHash + ':' +
                 modeResolved + ':' + siblingIndex + '/' + siblingCount + ':' +
                 (manualRoute ? waypointsHash : obstacleEpoch)
srcGeomHash = quantize(x,1) ^ quantize(y,1) ^ quantize(w,1) ^ quantize(h,1)
obstacleEpoch = a board-level counter bumped when any node's geometry changes and the
                edge's mode is 'orthogonal' or resolved-orthogonal 'smart'
```

Quantizing at 1 canvas unit prevents sub-pixel jitter from invalidating everything during a drag.

### 8.2 Invalidation strategy on node move

Moving a node must not re-route the whole board. The rule set:

1. Maintain `nodeId → edgeIds` adjacency (a `Map<string, Set<string>>` kept in sync with the CRDT).
   A move invalidates only incident edges — O(deg).
2. **During** a drag (pointer down → up), incident edges route in **draft mode**: `curved` and
   `smart` degrade to `curved` with no obstacle checks; `orthogonal` degrades to the Z-fallback.
   No A\*, ever, during a drag. On pointer-up, the affected edges are re-routed at full fidelity in
   the worker, and the result swaps in on the next frame (typically < 1 frame later; if the worker
   is slow the draft geometry stays visible — it is never wrong, only less pretty).
3. Orthogonal edges _not_ incident to the moved node can become obstructed. Re-routing all of them
   would be O(E). Instead: on pointer-up, query the spatial index for edges whose cached bbox
   intersects the moved node's old **or** new inflated box (an R-tree over edge bboxes, maintained
   incrementally) and invalidate only those — typically < 30 edges. `obstacleEpoch` is used as a
   tiebreaker so a stale geometry can never be reused after such an invalidation.
4. Group move (N nodes): coalesce; compute the union bbox delta once, invalidate the union of
   incident edges plus the intersecting orthogonal set, and dispatch a single worker batch.
5. Camera movement never invalidates routing (routing is in canvas units, zoom-independent).

### 8.3 Manual waypoints surviving node movement

Each waypoint stores `rel`, chosen at creation time:

```text
assignRel(w, p0, p1):
  d0 ← |w − p0|;  d1 ← |w − p1|;  dm ← |w − midpoint|
  if min = d0 and d0 < 160  → base 'source',   dx,dy = w − p0
  if min = d1 and d1 < 160  → base 'target',   dx,dy = w − p1
  else                      → base 'midpoint', dx,dy = w − midpoint
```

On node move, waypoints are re-derived:

```text
materialize(w, p0, p1):
  source   → p0 + (dx,dy)
  target   → p1 + (dx,dy)
  midpoint → ((p0+p1)/2) + (dx,dy) rotated by (angleNow − angleAtCreation)
             and scaled by clamp(distNow/distAtCreation, 0.5, 2)
  absolute → (dx,dy) as world coordinates (set when the user holds Ctrl while dragging
             a waypoint, meaning "pin this to the canvas, not to the nodes")
```

`angleAtCreation` and `distAtCreation` are stored inside `rel` as part of `dx/dy` normalization:
`dx/dy` for `midpoint` are stored **in the edge-local frame** (x along `p1−p0`, y perpendicular),
which makes the rotation and scaling above a pure basis change. This is why a hand-routed edge
still looks hand-routed after the user drags a node halfway across the board.

`manualRoute = true` disables mode-driven re-shaping entirely: the geometry becomes
"polyline/Catmull-Rom through the materialized waypoints", with endpoint clipping and arrowheads
still applied. `Reset routing` (Ctrl+Shift+R) clears it.

---

## 9. Labels

### 9.1 Anchor and box

- `labelAnchor` is the point at parameter `style.labelPosition` (default 0.5) along `flat`, plus
  `style.labelOffset` in the edge-local frame.
- The label box is measured once per `(text, fontSize)` with a cached `TextMetrics` map; height is
  fixed at 18 px screen, padding 4×6 px, background `--surface-2` at 88% alpha, radius
  `--radius-chip`, 1 px `--border-subtle`. Text never rotates (rotated text is unreadable at scale
  and expensive); the chip is always axis-aligned.
- Long labels truncate to 28 characters at L2 and 48 at L3, with the full text in the tooltip and
  the inspector.

### 9.2 Overlap avoidance

Run once per frame, only for the labels that passed the LOD filter, over the visible set:

```text
placeLabels(candidates):
  sort by priority: selected > hovered > confidence rank > weight > id
  grid ← uniform hash, cell 48×24 screen px
  for each candidate c:
      for each t in [c.t, c.t±0.12, c.t±0.24, c.t±0.36]:      # slide along the path
          for each perp in [0, -14, +14, -26, +26]:            # push off the path
              box ← measure(c) at point(t) + perp·normal(t)
              if grid.isFree(box) and box ⊄ any visible node box:
                   commit(box); insert into grid; next candidate
      if nothing fit: skip the label (draw a 3 px dot at midpoint instead)
```

Complexity O(k · 25) with uniform-hash O(1) tests, k = visible labels (capped at 250 per frame;
beyond that, only selected/hovered labels are drawn). The dot fallback keeps the user aware a label
exists — hovering shows it.

### 9.3 Label content

Default label text is empty; the _type_ is conveyed by color, dash and arrowhead. When the user
sets `label`, it is shown verbatim. Two display toggles exist per board (view setting, not document
data): `Show relationship types as labels` (renders `def.label` when `label` is empty) and
`Show confidence badges` (a 1-char suffix `⁇` for unverified, `!` for confirmed).

---

## 10. Interaction: hit-testing, hover, animation

### 10.1 Hit-testing

```text
hitTestEdges(pointWorld, tolerance):
  tolWorld ← tolerance / zoom          # tolerance = 8 screen px, 12 on coarse pointers
  candidates ← edgeRTree.query(box(pointWorld, tolWorld))
  best ← null
  for each edge in candidates (reverse paint order):
      d ← distanceToPolyline(pointWorld, geom.flat)   # early-out per segment via bbox reject
      if d ≤ tolWorld and (best = null or d < best.d): best ← {edge, d}
  # labels are hit-tested first, as separate rects, since they are the visual affordance
  return best
```

`distanceToPolyline` uses the standard point-segment distance with an early bounding-box reject per
segment; on a flattened path of ≤ 64 segments this is ≤ 64 cheap tests, and the R-tree keeps the
candidate count in the single digits. Bezier curves are never solved analytically — the flattened
polyline is accurate to 0.35 units, far below the 8 px tolerance.

Priority when a click hits both a node and an edge: node wins, except when the click is on the
edge's label chip or within 4 px of the path and ≥ 6 px outside the node border.

### 10.2 Hover and selection states

| State                  | Rendering                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| idle                   | type style, confidence alpha                                                                                                           |
| hover                  | +0.75 px width, alpha → 1.0, label forced visible, cursor `pointer`, 90 ms transition                                                  |
| selected               | `--accent` stroke, 6 px halo at 18% alpha, endpoint handles, waypoint handles at L3                                                    |
| multi-selected         | same but no handles                                                                                                                    |
| dimmed                 | when a "focus subgraph" filter is active and this edge is out of scope: alpha 0.12, no label                                           |
| dragging-waypoint      | live re-route each frame in draft mode, snap guides to lanes/45°                                                                       |
| invalid                | 2 px `--danger` dashed overlay + inspector issue (endpoint constraint warning)                                                         |
| archived               | 35% alpha, dotted                                                                                                                      |
| past (`validTo < now`) | 55% alpha, `past` badge                                                                                                                |
| orphaned               | one endpoint soft-deleted: 25% alpha, endpoint rendered as a hollow circle at the last known position; hidden by default (view toggle) |

### 10.3 Reduced motion

Every animation below is disabled under `prefers-reduced-motion: reduce` (N6): draw-on creation,
flow animation, hover width transition (becomes instant), bundle expansion.

### 10.4 Animated flow (`derived_from`)

Subtle, cheap, and off by default above a threshold:

```text
constraints:
  - only edges with style.animated (default true for `derived_from`, false otherwise)
  - only at L2/L3
  - only for edges intersecting the viewport
  - hard cap: 60 animated edges per frame (nearest to viewport center wins); above the
    cap the dash offset is frozen (still legible, zero cost)
  - disabled entirely when the last 30 frames averaged > 12 ms (adaptive degradation,
    16_PERFORMANCE.md §6)
implementation:
  ctx.setLineDash([6, 10]); ctx.lineDashOffset = -(t_ms * 0.018) % 16
  amplitude: the dashed segment is the same color at 55% alpha over the solid base path,
  i.e. two strokes; no glow, no gradient (00_MASTER.md §3.5 "calm interface")
```

Animated edges do **not** force a full repaint of the scene: the edge layer is drawn to its own
offscreen canvas that is only invalidated when geometry or style changes; the animated subset is
drawn on top of that composite each frame (`05_CANVAS_ENGINE.md` §6.4).

---

## 11. Bulk behavior and performance rules

Budget (subset of `16_PERFORMANCE.md` §3, restated as the edge layer's contract):

| Metric                                       | Budget at 10,000 edges                 |
| -------------------------------------------- | -------------------------------------- |
| Edge layer draw, p95                         | ≤ 4.5 ms/frame                         |
| Visible edges typical                        | ≤ 1,200 (viewport culled)              |
| Stroke calls per frame                       | ≤ 40 (style batching)                  |
| Route cache hit rate during pan/zoom         | 100% (camera never invalidates)        |
| Route cache hit rate during a 20-node drag   | ≥ 97%                                  |
| Full re-route of 10,000 edges (worker, cold) | ≤ 900 ms, chunked, never blocking      |
| Memory for geometry cache                    | ≤ 48 MB (slab-allocated Float32Arrays) |

### 11.1 Rules

1. **Cull before route.** Never route an edge that is not in the expanded viewport, unless the
   worker is doing an idle warm pass.
2. **Never allocate in the draw loop.** No object literals, no `Path2D` per edge (reuse pooled ones
   per style bucket), no string building (colors are resolved to `rgba` strings once per theme
   change and cached).
3. **Bounded work per frame.** The main thread routes at most 24 edges per frame (draft mode);
   everything else is queued to the worker. If the queue exceeds 2,000, drop to L1 fidelity for the
   backlog.
4. **Coalesce invalidation.** Node move events are coalesced per frame; a 200-node group drag issues
   exactly one invalidation batch, not 200.
5. **Edge R-tree maintenance is incremental.** Insert/remove on geometry revision change only; a
   full rebuild is allowed only on board load and is chunked at 2,000 edges per idle callback.
6. **Bundling above 7 parallel edges** (§7.6) and above 400 edges incident to a single node
   (hub nodes): incident edges beyond 400 are collapsed into a "N more" spoke chip; expanding it
   opens the node's relationship list in the inspector instead of drawing them.
7. **Selection of > 500 edges** switches the selection rendering to a single bounding overlay; per
   edge halos are not drawn.
8. **Delete of > 200 edges** runs in one transaction with a progress toast and a single undo entry.

### 11.2 Worker offload

```text
apps/web ── routingWorker (module worker) ──────────────────────────
  postMessage { type: 'route-batch', epoch, items: RouteInputPacked[] }
  ← { type: 'routed', epoch, results: RoutedPacked[] }

Packing: RouteInputPacked is a flat Float64Array view over a SharedArrayBuffer when
cross-origin isolation is available; otherwise a transferable ArrayBuffer per batch.
Geometry comes back as transferable Float32Array buffers (no structured-clone of objects).
Batch size: 256 edges. Epoch guards staleness — results from an older epoch are discarded.
Worker holds its own copy of the obstacle grid inputs (node boxes as a packed array,
diffed per epoch), so it never needs the CRDT.
```

Only `orthogonal` (A\*) and full-fidelity `smart` resolution are offloaded; `straight` and `curved`
are cheap enough to run inline (≤ 6 µs each) and offloading them would cost more in messaging than
it saves.

### 11.3 Caching keys summary

| Cache                   | Key                     | Eviction                                                   |
| ----------------------- | ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | ------- | ----------------------- |
| geometry                | `routeKey(edge)` (§8.1) | LRU, 20,000 entries or 48 MB                               |
| flattened polyline slab | geometry id             | freed with the geometry entry, buffer returned to the pool |
| label metrics           | `${text}                | ${fontPx}`                                                 | LRU 4,000                                             |
| style resolution        | `${type}                | ${confidence}                                              | ${themeId}                                            | ${lod}` | cleared on theme change |
| sibling grouping        | `min(idA,idB)+'         | '+max(idA,idB)`                                            | invalidated when an edge in the pair is added/removed |
| obstacle grid           | `${regionQuantized}     | ${obstacleEpoch}`                                          | LRU 64, cleared on board change                       |

---

## 12. Graph queries the edge model must support

These drive the index choices in `08_DATA_MODEL.md` §4.10 and the query shapes in
`09_BACKEND.md` §5. Listed here because they constrain the model.

| Query                                              | Shape                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| neighbors of node N (both directions, active only) | index on `(board_id, source_node_id)` and `(board_id, target_node_id)` with partial `WHERE deleted_at IS NULL` |
| shortest path N→M ≤ 6 hops                         | recursive CTE over the projection, `weight` as cost                                                            |
| all evidence supporting hypothesis H               | `type = 'supports' AND target_node_id = H`                                                                     |
| edges valid at time T                              | `observed_at <= T AND (valid_to IS NULL OR valid_to >= T)`                                                     |
| subgraph of a tag                                  | join through `node_tags` on both endpoints                                                                     |
| degree histogram (hub detection)                   | materialized counter maintained by the projection                                                              |
| duplicate edge detection                           | unique index on `(board_id, source_node_id, target_node_id, type)` where `deleted_at IS NULL`                  |

---

## 13. Accessibility

- Every edge is reachable by keyboard through the node-to-node traversal of §5.2, and is announced
  as `"{source title} {type label} {target title}, confidence {x}, {label}"`.
- The selected edge exposes its actions through the same context menu as the pointer path
  (`Shift+F10` / Menu key).
- Edge _type_ is never conveyed by color alone (N6): every type has a distinct dash pattern and/or
  arrowhead, listed in §3.2. A "high contrast edges" board setting raises all edge alphas to 1.0 and
  widens strokes by 0.5 px.
- The relationship list in the node inspector is the non-visual equivalent of the graph: it lists
  every incident edge, grouped by direction, with the same actions.

---

## 14. Open risks

1. **A\* budget exhaustion on very dense boards** produces the Z-fallback, which can cross nodes.
   Mitigated by `geom.degraded` (rendered with a subtle 1 px lighter core so it is honest about
   being approximate) and by the fact that the fallback is stable, not flickering. If measured
   degradation exceeds 2% of orthogonal edges on the 5,000-node benchmark, the fix is to raise the
   expansion budget in the worker only (main thread must stay bounded).
2. **SharedArrayBuffer requires cross-origin isolation**, which conflicts with third-party embeds
   (`06_NODE_SYSTEM.md` §4.18). Decision: embeds win, isolation is opt-in per deployment; the
   worker falls back to transferable buffers, costing ~0.4 ms per 256-edge batch. Validate the
   fallback path in the benchmark, not just the fast path.
3. **Manual waypoint transformation under extreme node movement** (a node dragged 10,000 units)
   can produce visually odd paths despite the clamped scaling. Users can `Ctrl+Shift+R`. A future
   improvement would be to detect "clearly broken" routes (self-intersection count > 2) and offer
   an inline "Reset this route?" chip.
4. **Bundling hides individual edge semantics.** A bundle of 12 mixed-type edges is rendered as one
   line; the count chip mitigates it but a user could misread the graph. Bundling therefore only
   collapses edges _of the same category_; mixed categories stay separate even above the threshold.
5. **`same_as` vs merge divergence.** Users can create `same_as` edges without merging, producing a
   graph where identity is asserted but the data is still split. The Duplicates panel surfaces
   these continuously; we deliberately do not auto-merge (N4).
6. **Edge R-tree accuracy during draft routing.** Draft geometry has a different bbox than the final
   route, so the tree is briefly approximate during a drag. Hit-testing is therefore performed
   against the _drawn_ geometry, and the tree is updated on pointer-up. Acceptable: a mis-hit during
   an active drag has no user-visible consequence.

---

## 15. Implementation status

### 15.1 Shipped (P5 part 1 — relationship layer)

| Section | Where it lives                                                                        |
| ------- | ------------------------------------------------------------------------------------- |
| §3.1    | `packages/domain/src/edges/types.ts`, `registry.ts`, `define.ts`                      |
| §3.2    | `packages/domain/src/edges/builtins.ts` (22 taxonomy types + `related_to` + `custom`) |
| §3.4    | `packages/domain/src/edges/validation.ts`                                             |
| §2.1    | `normalizeUndirected` / `edgeIdentityKey` in `packages/domain/src/edges/semantics.ts` |
| §2.3    | `resolveEdgeVisual` in `packages/domain/src/edges/defaults.ts`                        |
| §5.3    | `suggestEdgeTypes` / `bestEdgeType` in `semantics.ts`                                 |

### 15.2 Deviations from the text above, and why

1. **Schema location.** §2 sketches `packages/domain/src/edges/schema.ts`; the schema shipped in P3
   as `packages/domain/src/entities/edge.ts` and is not moved — the document format is frozen and a
   move would churn every importer for no behavioural gain. The edges directory holds semantics.
2. **Confidence values.** The document schema uses `low | medium | high | unknown` (08 §2.2.3);
   §2.3's `confirmed`/`unverified` names are mapped onto `high`/`unknown`. Opacity buckets are
   unchanged.
3. **Dash representation.** The document stores a numeric dash array; the taxonomy speaks in names
   (`solid | dashed | dotted | dash-dot`). `resolveEdgeVisual` returns the name and `dashPattern()`
   turns it into canvas units, so an explicit numeric override still wins.
4. **`related_to`.** Added to the built-ins because it is the schema default of `makeEdge`; without
   it every hand-drawn edge would fall back to `custom`.
5. **Suggestion scoring.** The `allowed` term of §5.3 is graded by how specific the matching
   endpoint rule is (`matchSpecificity`) instead of being a flat 0/1. With a flat term, `person →
organization` ranked `alias_of` above `works_at` purely on alphabetical tie-breaking; grading
   keeps the narrow, more informative relationship on top. Weights are unchanged.

### 15.3 Shipped (P5 part 2 — routing, caching, hit-testing, labels)

| Section     | Where it lives                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------- |
| §4.3        | `EdgeGeometry` and the flattener in `packages/domain/src/edges/routing/types.ts`, `geometry.ts` |
| §7.1        | `packages/domain/src/edges/routing/ports.ts` (side choice, offset, drag hysteresis)             |
| §7.2, §7.3  | `routing/straight.ts`, `routing/curved.ts` (endpoint normals, Catmull-Rom through waypoints)    |
| §7.4        | `routing/clip.ts` (rounded-rect containment, bisected crossing, `trimPolyline`)                 |
| §7.5        | `routing/selfloop.ts`                                                                           |
| §7.6        | `routing/separation.ts` (`siblingOffset`, bundling thresholds)                                  |
| §7.7        | `routing/orthogonal.ts` (Hanan grid, A\* with a turn penalty, Z-fallback, post-processing)      |
| §7.8        | `routing/smart.ts`                                                                              |
| §8.1, §8.2  | `routing/cache.ts` (`routeKey`, LRU `RouteCache`, per-node adjacency, obstacle epoch)           |
| §9.1, §9.2  | `routing/labels.ts` (`labelAnchor`, `placeLabels`, uniform hash)                                |
| §10.1       | `routing/hit-test.ts` (`hitTolerance`, `distanceToEdge`, `nearestPointOnEdge`, `pickEdge`)      |
| engine seam | `createRoutedEdgePath` in `packages/canvas-engine/src/render/routed-edge-path.ts`               |
| bench       | `route-smart-2000-edges` in `bench/routing.bench.ts`                                            |

### 15.4 Deviations in part 2, and why

1. **Routing lives in `packages/domain`, not in the engine.** §7 already asks for pure functions;
   putting them in the domain package keeps the engine free of graph semantics and lets the same
   code run inside the routing worker without a build-time split.
2. **Sibling offset on curves.** §7.6 asks for control points shifted by `offset` _and_ a mid-curve
   shifted by `2 · offset`. A cubic moves its midpoint by ¾ of a shift applied to both controls, so
   the implementation shifts the controls by `8/3 · offset`, which produces exactly the mid-curve
   displacement the spec asks for with one operation instead of two conflicting ones.
3. **A\* cost terms.** `TURN_PENALTY` is implemented; `LANE_PENALTY` and `CROSS_PENALTY` are not,
   because both need board-wide state (which lanes and which other edges are already routed) that
   only exists once the renderer drives routing for a whole frame. Lane _alignment_ is still
   achieved by the `snapToLanes` post-process. The two penalties return with the worker batch in
   part 3.
4. **Blocked lattice points.** In a Hanan grid the obstacle borders _are_ lattice coordinates, so a
   point-in-box test alone would never block anything for a single obstacle. Blocking is therefore
   decided per _segment_ (`segmentBlocked`), with axis-aligned degenerate segments handled
   explicitly: grazing a border is allowed, crossing an interior is not.
5. **Staircase simplification.** §7.7's post-process 2 ("remove a point if the path stays clear")
   cannot remove a single point from a rectilinear path without making it diagonal. The
   implementation removes a _pair_ of corners instead — turning early or turning late, whichever
   stays clear — which is the same intent expressed correctly.
6. **Manual waypoints** arrive at the router already materialized in canvas units; the relative
   frame bookkeeping of §8.3 belongs to the document layer and lands with the inspector UI in part 3.

7. **Bounded work per edge.** The `route-smart-2000-edges` budget (900 ms, 18_TESTING.md §9.1) does
   not survive an unbounded Hanan lattice: the lattice grows quadratically with the obstacle count
   and the search cubically. Four measures keep it affordable, in the order they pay off:
   a cheap-candidate probe (the two L- and two Z-shapes) that skips A\* and the lattice entirely
   whenever one of them is clear; a hard cap of `MAX_REGION_OBSTACLES = 16` nearest cards per route,
   selected in one pass instead of a sort; per-obstacle range marking of blocked lattice points
   (O(cells) instead of O(cells · obstacles)); and reused A\* scratch buffers. Measured headlessly:
   6,067 ms → 520 ms for 2,000 smart edges over the 5,000-node scene, with 8 degraded routes.

### 15.5 Shipped (P5 part 3 — creation, selection and the relationship UI)

| Section     | Where it lives                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------- |
| §5.1, §5.2  | `packages/canvas-engine/src/edges/ports.ts` (10 px band), FSM `connecting` state               |
| §5.4        | `connect-to-empty` intent + `apps/web/src/edges/ConnectionOverlay.tsx` quick menu              |
| §6          | `apps/web/src/edges/EdgeInspector.tsx`, `EdgeContextMenu.tsx`, `edgeCommands.ts`               |
| §10.1       | `packages/canvas-engine/src/edges/pick.ts` (picker over the _drawn_ geometry)                  |
| §10.2       | selected-edge stroke and endpoint dots in `render/layers.ts`; pending line in `drawConnection` |
| §13         | keyboard creation: `C` starts, `Tab` cycles candidates by proximity, `Enter` confirms          |
| host wiring | `createRoutedEdgePath` + `createEdgePicker` in `apps/web/src/app/canvas/useCanvasEngine.ts`    |
| appearance  | `apps/web/src/edges/edgeVisual.ts` (type colour, dash, width, routing into the `EdgeView`)     |

### 15.6 Deviations in part 3, and why

1. **Edge hit-testing is injected, not built in.** `engine.ts` stays free of domain imports; the
   host passes `edgeHit`, built by `createEdgePicker` over the routed geometry. Without it edges are
   simply not selectable, which is exactly the P2 behaviour.
2. **Port side outside a card.** §5.1 says "nearest border". Outside the card at low zoom the band
   is wider than the card, so nearest-border picks absurd sides; the implementation uses the
   overshoot direction outside and nearest-border inside.
3. **The relationship type is suggested, not asked for.** A modal type picker mid-drag breaks the
   gesture; `bestEdgeType` picks, the inspector corrects. Refusals (duplicate, self-loop) surface as
   a board notice instead of silently dropping the gesture.
4. **The inspector writes directly**, like the node inspector, instead of going through engine
   intents: the engine has no vocabulary for relationship semantics and should not grow one.

### 15.7 Not yet implemented

Waypoint editing and `rel` materialization (§8.3), label content toggles (§9.3), animated flow
(§10.3–§10.4), bundling render and the worker offload (§11.1–§11.2), graph queries (§12) — P5
part 4, tracked in `20_ROADMAP.md`.
