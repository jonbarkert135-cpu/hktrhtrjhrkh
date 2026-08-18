# 05 — CANVAS ENGINE

## Scope

Defines `packages/canvas-engine`: the framework-agnostic rendering and interaction engine that
draws the Raven board and turns pointer/keyboard input into intents. Covers renderer selection,
coordinate systems, camera, scene graph, spatial index, render pipeline and LOD, the interaction
finite state machine, edge routing hand-off, undo/redo integration, worker architecture, memory
management and test hooks. It does **not** define node payload schemas (`06_NODE_SYSTEM.md`),
edge semantics and routing algorithms (`07_EDGE_SYSTEM.md`), the Y.Doc schema
(`08_DATA_MODEL.md`), or the visual tokens it consumes (`04_DESIGN_SYSTEM.md`).
Frozen constraints come from `00_MASTER.md` §2 and §4 (N1, N3, N6) and must not be re-decided.

---

## 1. Options analysis

The requirement set that any candidate must satisfy simultaneously:

- **R-A** 5,000 nodes / 10,000 edges, p95 pan-zoom frame ≤ 16.6 ms (N1).
- **R-B** Rich cards: HTML rich text, favicons, image previews, badges, inline editing, selectable
  text, native focus rings, screen-reader semantics (N6).
- **R-C** Our own document model (Yjs `Y.Doc`, typed entity graph) is authoritative; the renderer
  owns no document.
- **R-D** No React dependency inside the engine (`00_MASTER.md` §5 layer rule).
- **R-E** Deterministic, testable frame behaviour (headless snapshots, synthetic input).

| #   | Option                                                                | Pros                                                                                                                                                                                                                                                      | Cons                                                                                                                                                                                                                              | Practical ceiling                                  | Verdict                                                                               |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **Pure DOM + SVG** (absolutely positioned divs, `<svg>` edges)        | Maximum fidelity for R-B; native a11y, text selection, focus; simplest mental model; CSS transitions free                                                                                                                                                 | Layout/paint cost scales with node count; SVG path count dominates; browser style recalc on camera change; no LOD story                                                                                                           | ~300–600 rich nodes before pan drops below 60 fps  | Rejected as the only renderer; **kept as the overlay layer**                          |
| 2   | **React Flow / xyflow**                                               | Batteries included: handles, connection UX, minimap, controls; large ecosystem                                                                                                                                                                            | Renders every node as React DOM + SVG edges; documented perf degradation around several hundred rich DOM nodes; owns node/edge state shape, which fights Yjs as the document (R-C) and forces React inside the engine (R-D)       | Several hundred rich nodes                         | Rejected                                                                              |
| 3   | **tldraw SDK**                                                        | Proven techniques we need: spatial index, viewport culling via `display:none` for offscreen shapes, a stable "efficient zoom level" held during camera movement above ~500 shapes; excellent input handling                                               | Owns its own document/shape/store model and its own persistence and undo; our entities are a typed knowledge graph with provenance, not shapes; two document models would have to be reconciled bidirectionally (R-C)             | High, but at the cost of a second source of truth  | Rejected as a dependency; **its techniques are adopted explicitly**                   |
| 4   | **Pure Canvas2D** (everything painted)                                | One draw loop, trivially cullable, cheap to batch, easy to reason about frame cost; excellent for edges and far-zoom glyphs                                                                                                                               | Rich text layout, inline editing, image `object-fit`, focus rings, screen readers all have to be re-implemented; fails R-B and N6                                                                                                 | 10k+ simple shapes                                 | Rejected as the only renderer; **kept as the base layer**                             |
| 5   | **WebGL (pixi / regl)**                                               | Highest raw throughput; instanced quads; tens of thousands of primitives                                                                                                                                                                                  | Text is the problem: SDF atlases or texture-per-card; card content changes constantly (unfurl, edit) so atlas churn is high; context-loss handling; no a11y; bigger bundle; debugging cost                                        | 50k+ primitives, but R-B unattainable              | Rejected for v1; kept as a documented escape hatch (§3.6)                             |
| 6   | **OffscreenCanvas + rendering worker**                                | Removes paint from the main thread; jank isolation                                                                                                                                                                                                        | Input still arrives on the main thread, so hit-testing state must be mirrored or round-tripped; DOM overlay must stay on the main thread anyway, so the two layers can desynchronise by a frame; Safari support historically lags | Good, with sync complexity                         | Rejected for the _render_ loop; workers are used for routing/layout/index/search (§9) |
| 7   | **Hybrid: Canvas2D base + DOM overlay for the visible near-zoom set** | Canvas cost is O(visible primitives) and independent of total node count; DOM cost is O(visible near-zoom nodes) which we cap; full R-B fidelity exactly where the user is looking; no third-party document model (R-C); no React inside the engine (R-D) | Two rendering paths to keep visually identical; overlay/canvas alignment must be sub-pixel exact; more engine code to own                                                                                                         | 5k nodes / 10k edges at 60 fps with the caps in §6 | **Chosen — frozen in `00_MASTER.md` §2**                                              |

### 1.1 The frozen decision

**Hybrid canvas + DOM overlay + spatial index**, implemented in-house against the Raven entity
graph. Justification, in the order the constraints bite:

1. R-A eliminates options 1 and 2 outright. Node count in a real OSINT board routinely passes
   1,000 after two SpiderFoot imports (`12_SPIDERFOOT.md` §6).
2. R-B eliminates options 4 and 5 as _sole_ renderers: an analyst edits note text, selects it,
   copies it, and a screen reader must read it. Re-implementing a text engine is a multi-quarter
   project with worse results than the browser's.
3. R-C eliminates option 3. tldraw's store is a legitimately better whiteboard document than
   anything we would write — but we are not building a whiteboard; we are rendering a CRDT-backed
   typed graph with provenance, and a two-way bridge between tldraw records and Y.Doc entities is
   a permanent correctness liability (`00_MASTER.md` §2, decision 1).
4. What remains is 7. The insight that makes it cheap: **fidelity is only needed where the user
   can perceive it.** Below `zoom = 0.55` a 320 px card is ≤ 176 px wide and its body text is
   unreadable; a canvas glyph is indistinguishable from the DOM card at that size. So the DOM set
   is bounded by _screen area_, not by board size.

### 1.2 Exact renderer-path selection rules

The renderer chooses a path per node, every frame, from three inputs: current LOD level (§6.4),
node kind, node interaction state.

| Condition                                                                                                | Path                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node outside the culling rect (viewport + margin ring, §6.6)                                             | **Not rendered at all.** No canvas draw, no DOM node.                                                                                                                                                                |
| LOD `L0` (`zoom < 0.18`)                                                                                 | Canvas: 1 filled rect per node in cluster colour, no text, no border, no icon. Edges drawn as straight hairlines.                                                                                                    |
| LOD `L1` (`0.18 ≤ zoom < 0.40`)                                                                          | Canvas: rounded rect + 2 px type stripe + type-colour dot. No text.                                                                                                                                                  |
| LOD `L2` (`0.40 ≤ zoom < 0.55`)                                                                          | Canvas: rounded rect + stripe + icon glyph + title rendered as a **single clipped line** of canvas text. No body, no preview image.                                                                                  |
| LOD `L3` (`zoom ≥ 0.55`) and node is inside the DOM budget (§6.7)                                        | **DOM overlay**: the full React card. Canvas draws nothing for that node except its selection ring if selected (rings are always canvas, §6.3).                                                                      |
| LOD `L3` but node is outside the DOM budget (overflow beyond `MAX_DOM_NODES`)                            | Canvas `L2` rendering; the node is queued for promotion next frame in distance-from-viewport-centre order.                                                                                                           |
| Node is being dragged, resized, or is a connection endpoint, at any LOD ≥ L1                             | Canvas **ghost** representation on the interaction layer; its DOM element (if any) keeps its last committed transform and is hidden (`visibility: hidden`) for the drag duration, so no DOM writes happen per frame. |
| Node is in `edit-text` state                                                                             | Always DOM, always promoted regardless of budget, and the camera is clamped so `zoom ≥ 0.55` while editing (§7.6).                                                                                                   |
| Node kind `image` / `screenshot` at L2                                                                   | Canvas draws the cached thumbnail (`16_PERFORMANCE.md` §5.13) instead of an icon glyph.                                                                                                                              |
| Node kind `group` (container)                                                                            | Always canvas at every LOD (fill + border + label); groups never become DOM. Their children follow the normal rules.                                                                                                 |
| Edges, grid, marquee, snap guides, alignment guides, selection rings, resize handles, connection preview | **Always canvas**, at every LOD.                                                                                                                                                                                     |

Two hard invariants follow, and every implementation change must preserve them:

- **I1 — Never both.** A node is drawn on canvas _or_ mounted in the DOM overlay, never both
  (except its canvas selection ring). Violating this produces the double-rendered "ghost text"
  artefact and is caught by the headless snapshot test `dom-canvas-exclusivity.test.ts`.
- **I2 — Never per-frame DOM writes during a camera or drag gesture.** The overlay container is
  moved with a single `transform` on one parent element; individual cards are not re-positioned
  while the camera moves (§6.7).

---

## 2. Package layout

`packages/canvas-engine` has **no** dependency on React, on Yjs, or on the DOM component library.
It depends only on `packages/config` and on `packages/domain` **types** (type-only imports; a
lint rule `no-value-import-from-domain` enforces this so the engine stays tree-shakeable and
testable in node).

```text
packages/canvas-engine/
├─ package.json                 name: @nexus/canvas-engine, "sideEffects": false
├─ README.md                    public API contract (kept in sync per 00_MASTER §10.4)
├─ src/
│  ├─ index.ts                  public barrel — the ONLY export surface (§3)
│  ├─ engine.ts                 CanvasEngine class: lifecycle, wiring, frame loop ownership
│  ├─ types.ts                  shared structural types (Vec2, Rect, NodeView, EdgeView, …)
│  ├─ camera/
│  │  ├─ camera.ts              Camera model, pan/zoom/fit/focus, clamping (§5)
│  │  ├─ zoom-curve.ts          non-linear zoom mapping + snap stops
│  │  ├─ input-normalize.ts     wheel/trackpad/pinch normalization (§5.5)
│  │  └─ viewport-store.ts      viewport persistence adapter (§5.7)
│  ├─ scene/
│  │  ├─ scene.ts               SceneGraph: authoritative render-side mirror of the graph
│  │  ├─ node-view.ts           NodeView record, derived geometry, dirty flags
│  │  ├─ edge-view.ts           EdgeView record, routed-path cache slot
│  │  ├─ z-order.ts             layer/z-index resolution, bring-to-front algebra (§7.12)
│  │  └─ groups.ts              group membership, bounds aggregation, lock inheritance
│  ├─ spatial/
│  │  ├─ grid-index.ts          uniform grid bucket index — the chosen index (§4)
│  │  ├─ index.contract.ts      SpatialIndex interface (swappable, benchmarked)
│  │  ├─ rtree-index.ts         reference R-tree implementation used ONLY in benchmarks
│  │  └─ queries.ts             viewport/point/marquee/nearest-handle query helpers
│  ├─ render/
│  │  ├─ renderer.ts            layer orchestration, frame composition, dirty-rect logic
│  │  ├─ scheduler.ts           rAF loop, deterministic clock hook, frame budget accounting
│  │  ├─ layers/grid.ts         grid + origin cross + axis hints
│  │  ├─ layers/edges.ts        edge painting from routed paths (§8)
│  │  ├─ layers/nodes-lod.ts    L0–L2 node glyph painting
│  │  ├─ layers/overlay.ts      DOM overlay mount/unmount orchestration + recycling pool (§6.7)
│  │  ├─ layers/interaction.ts  selection rings, handles, guides, marquee, connection preview
│  │  ├─ text.ts                canvas text measurement cache + ellipsis (§6.5)
│  │  ├─ paint-cache.ts         per-node offscreen glyph cache (bitmap LRU)
│  │  └─ dpr.ts                 devicePixelRatio handling, canvas sizing, resize observer
│  ├─ interaction/
│  │  ├─ fsm.ts                 the interaction FSM implementation (§7)
│  │  ├─ states/*.ts            one file per state, pure transition functions
│  │  ├─ pointer.ts             pointer capture, coalesced events, threshold constants
│  │  ├─ keyboard.ts            key map → intent, modifier tracking, space-pan latch
│  │  ├─ snapping.ts            object snap, grid snap, distribution guides (§7.8)
│  │  ├─ selection.ts           selection set semantics, marquee mode, additive/subtractive
│  │  └─ intents.ts             the Intent union emitted to the host (§3.3)
│  ├─ workers/
│  │  ├─ routing.worker.ts      edge routing (algorithms live in @nexus/domain)
│  │  ├─ layout.worker.ts       auto-layout runs
│  │  ├─ index.worker.ts        bulk spatial index rebuild
│  │  ├─ protocol.ts            message schemas + typed RPC wrapper (§9.2)
│  │  └─ pool.ts               worker pool, backpressure, cancellation tokens (§9.4)
│  ├─ memory/
│  │  ├─ pools.ts               object pools (Vec2, Rect, Path2D, DOM slots)
│  │  ├─ caches.ts              LRU + WeakRef caches with byte accounting
│  │  └─ teardown.ts            disposal registry (§10.3)
│  └─ testing/
│     ├─ clock.ts               deterministic clock, frame stepper
│     ├─ synthetic-input.ts     synthetic pointer/wheel/key sequences
│     ├─ headless.ts            node-canvas backed headless scene snapshots
│     └─ harness.ts             scene builders (`buildScene({nodes: 5000, edges: 10000})`)
└─ tests/                       vitest; ≥85% line coverage required (00_MASTER §8.7)
```

Responsibility rule: **`render/` never mutates scene state, `interaction/` never paints,
`scene/` never touches the DOM.** Enforced by dependency-cruiser (`19_DEPLOYMENT.md` §6).

---

## 3. Public API

The React app in `apps/web` binds to exactly these types. Everything else is internal.

### 3.1 Construction and lifecycle

```ts
// packages/canvas-engine/src/index.ts
export interface CanvasEngineOptions {
  /** Container the engine owns completely. It appends its own canvases + overlay root. */
  container: HTMLElement;
  /** Initial camera; if omitted the engine restores the persisted viewport (§5.7). */
  camera?: CameraState;
  /** Resolved design tokens; the engine never reads CSS variables at draw time. */
  theme: EngineTheme;
  /** Feature switches, all default-on except `debugOverlay`. */
  features?: Partial<EngineFeatures>;
  /** Injected for tests; defaults to rAF + performance.now (see testing/clock.ts). */
  clock?: EngineClock;
  /** Worker factory; injected so Vite can control bundling and tests can stub. */
  createWorker?: (kind: WorkerKind) => Worker;
}

export declare class CanvasEngine {
  constructor(options: CanvasEngineOptions);

  /** Replace the whole scene (board open, board switch). O(n) + one index build. */
  setScene(snapshot: SceneSnapshot): void;
  /** Apply an incremental patch (the Yjs observer path). O(changed). */
  applyPatch(patch: ScenePatch): void;

  readonly camera: CameraController; // §5
  readonly selection: SelectionController; // §7.11
  readonly query: SceneQuery; // §4.5

  /** Host subscribes to intents; the engine NEVER writes to Y.Doc itself. */
  on<E extends keyof EngineEvents>(e: E, fn: EngineEvents[E]): Unsubscribe;

  /** The host provides the DOM for near-zoom nodes; see §3.4. */
  setOverlayRenderer(r: OverlayRenderer): void;

  /** Force a full repaint (theme change, DPR change, font load). */
  invalidate(reason: InvalidateReason): void;

  /** Frees canvases, workers, observers, pools, listeners. Idempotent. */
  dispose(): void;
}
```

### 3.2 Scene data the engine consumes

The engine consumes a **flat, render-oriented projection** of the graph — never the Y.Doc, never
domain entities with payloads. `apps/web` builds this projection from Yjs observers.

```ts
export interface SceneSnapshot {
  nodes: NodeView[];
  edges: EdgeView[];
  groups: GroupView[];
  /** Ordered bottom→top. Nodes reference a layer by id. */
  layers: LayerView[];
}

export interface NodeView {
  id: NodeId; // string, ULID
  kind: NodeKind; // '06_NODE_SYSTEM.md' §2 registry key
  x: number;
  y: number; // world px, top-left
  w: number;
  h: number; // world px, ≥ MIN_NODE_SIZE
  z: number; // fractional index within layer (§7.12)
  layerId: LayerId;
  groupId: GroupId | null;
  rotation: 0; // reserved; nodes never rotate in v1 (see §12 risk R7)
  locked: boolean;
  hidden: boolean;
  /** Everything needed to paint L0–L2 WITHOUT reading the domain payload. */
  glyph: NodeGlyph;
  /** Opaque handle the host uses to render the DOM card; engine never inspects it. */
  domKey: string;
  /** Monotonic; bump to invalidate the paint cache for this node. */
  visualVersion: number;
}

export interface NodeGlyph {
  accent: RGBA; // resolved from tokens by the host
  fill: RGBA;
  icon: IconGlyphId; // pre-rasterized in the icon atlas
  title: string; // already truncated to ≤ 96 chars by the host
  badgeCount: number; // 0 = none
  thumbnailKey: string | null; // key into the thumbnail bitmap cache
  status: 'none' | 'running' | 'error' | 'stale';
}

export interface EdgeView {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  fromAnchor: AnchorSpec;
  toAnchor: AnchorSpec; // '07_EDGE_SYSTEM.md' §3
  routing: 'straight' | 'curved' | 'orthogonal' | 'smart';
  style: EdgeStyle; // colour, width, dash, arrow ends, opacity
  label: string | null;
  z: number;
  hidden: boolean;
  visualVersion: number;
}

export type ScenePatch =
  | { op: 'upsert-node'; node: NodeView }
  | { op: 'remove-node'; id: NodeId }
  | { op: 'move-nodes'; moves: Array<{ id: NodeId; x: number; y: number }> }
  | { op: 'resize-node'; id: NodeId; w: number; h: number }
  | { op: 'upsert-edge'; edge: EdgeView }
  | { op: 'remove-edge'; id: EdgeId }
  | { op: 'upsert-group'; group: GroupView }
  | { op: 'remove-group'; id: GroupId }
  | { op: 'set-layers'; layers: LayerView[] }
  | { op: 'bulk'; patches: ScenePatch[] }; // applied atomically, one index pass
```

`applyPatch` is the hot path during collaboration and drag; it must be O(changed) and must not
allocate per node beyond one pooled `Rect` (§10.1).

### 3.3 Intents — the only way the engine talks back

The engine is **pure with respect to the document**. It never mutates Yjs. It emits intents; the
host validates them against domain rules and writes to `Y.Doc` inside a transaction, which comes
back as a `ScenePatch`. This one-way loop is what makes undo/redo and multiplayer correct (§8.4,
`08_DATA_MODEL.md` §5).

```ts
export type Intent =
  | { t: 'select'; ids: EntityId[]; mode: 'replace' | 'add' | 'toggle' | 'subtract' }
  | { t: 'move-nodes'; deltas: Array<{ id: NodeId; dx: number; dy: number }>; phase: GesturePhase }
  | {
      t: 'resize-node';
      id: NodeId;
      w: number;
      h: number;
      x: number;
      y: number;
      phase: GesturePhase;
    }
  | { t: 'create-edge'; from: NodeId; fromAnchor: AnchorSpec; to: NodeId; toAnchor: AnchorSpec }
  | { t: 'create-node-from-drop'; at: Vec2; payload: DropPayload }
  | { t: 'reconnect-edge'; edgeId: EdgeId; end: 'from' | 'to'; to: NodeId; anchor: AnchorSpec }
  | { t: 'begin-edit-text'; id: NodeId }
  | { t: 'context-menu'; at: Vec2; target: HitTarget }
  | { t: 'delete'; ids: EntityId[] }
  | { t: 'z-order'; ids: EntityId[]; op: 'front' | 'back' | 'forward' | 'backward' }
  | { t: 'group'; ids: NodeId[] }
  | { t: 'ungroup'; groupId: GroupId }
  | { t: 'lock'; ids: EntityId[]; locked: boolean }
  | { t: 'align'; ids: NodeId[]; axis: AlignAxis }
  | { t: 'distribute'; ids: NodeId[]; axis: 'h' | 'v' }
  | { t: 'camera'; camera: CameraState; cause: CameraCause };

export type GesturePhase = 'start' | 'update' | 'end' | 'cancel';
```

`phase` is what lets the host batch a whole drag into **one** undo transaction (§8.4): `start`
opens a transaction, `update` writes with the same origin, `end` closes it, `cancel` rolls back to
the pre-gesture geometry that the host captured at `start`.

### 3.4 Overlay contract

```ts
export interface OverlayRenderer {
  /** Called once per frame with the exact promotion diff. Never called mid-gesture (I2). */
  sync(diff: OverlayDiff): void;
  /** Engine tells the host the container transform changed; host must NOT re-layout. */
  setTransform(t: { x: number; y: number; scale: number }): void;
}

export interface OverlayDiff {
  mount: Array<{ id: NodeId; domKey: string; slot: HTMLElement; rect: Rect }>;
  update: Array<{ id: NodeId; slot: HTMLElement; rect: Rect }>;
  unmount: Array<{ id: NodeId; slot: HTMLElement }>; // slot returns to the pool
}
```

The React binding (`apps/web/src/canvas/OverlayHost.tsx`) renders each mounted node through
`createPortal(<NodeCard id/>, slot)`. React is thus _outside_ the engine and the engine's own
frame loop never renders React.

---

## 4. Coordinate systems

Three spaces, three conversion functions, no ad-hoc arithmetic anywhere else in the codebase.

| Space      | Unit                                           | Origin                                      | Used by                                                            |
| ---------- | ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| **World**  | world px (1 world px = 1 CSS px at `zoom = 1`) | board origin `(0,0)`, `+x` right, `+y` down | all persisted geometry, spatial index, routing, layout             |
| **Screen** | CSS px relative to the container's top-left    | container top-left                          | pointer events, DOM overlay, tooltips, menus                       |
| **Device** | physical px                                    | canvas top-left                             | canvas backing store only, via `ctx.setTransform(dpr,0,0,dpr,0,0)` |

```ts
// world → screen
sx = (wx - camera.x) * camera.zoom;
sy = (wy - camera.y) * camera.zoom;
// screen → world
wx = sx / camera.zoom + camera.x;
wy = sy / camera.zoom + camera.y;
```

`camera.x/y` is the **world coordinate of the container's top-left corner**. This choice (rather
than a centre-anchored camera) makes viewport rectangles a subtraction with no half-size terms and
removes an entire class of off-by-half bugs.

Rules:

- Persisted geometry is **always** world px. Nothing in `Y.Doc` is ever screen px.
- DPR is applied once, in `render/dpr.ts`, when sizing the canvas backing store:
  `canvas.width = Math.round(cssW * dpr)`, `style.width = cssW + 'px'`, then
  `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. Every layer then draws in CSS px.
- `dpr` is clamped to `min(devicePixelRatio, 2)`. Above 2 the memory and fill cost triples for no
  perceptible gain on a canvas of flat shapes (measured budget: `16_PERFORMANCE.md` §3.1).
- **Sub-pixel alignment between canvas and DOM:** the overlay container uses
  `transform: translate3d(Xpx, Ypx, 0) scale(S)` with the _identical unrounded_ camera values the
  canvas uses. Never round one and not the other; a 0.5 px mismatch is visible as a shimmering
  selection ring during pan. Test: `overlay-alignment.spec.ts` compares the DOM rect of a card to
  the canvas-projected rect at 12 zoom levels, tolerance 0.25 px.

---

## 5. Camera

### 5.1 Model

```ts
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface CameraController {
  readonly state: Readonly<CameraState>;
  panBy(dxScreen: number, dyScreen: number): void;
  zoomTo(zoom: number, anchorScreen: Vec2, opts?: { animate?: boolean }): void;
  zoomBy(steps: number, anchorScreen: Vec2): void; // steps in curve units (§5.3)
  fit(rect: Rect, opts?: { padding?: number; maxZoom?: number; animate?: boolean }): void;
  fitAll(opts?): void; // fit(sceneBounds)
  focus(id: EntityId, opts?: { zoom?: number; animate?: boolean }): void;
  reset(): void; // {x:0,y:0,zoom:1}
  screenToWorld(p: Vec2): Vec2;
  worldToScreen(p: Vec2): Vec2;
  get viewportWorld(): Rect;
}
```

### 5.2 Limits

| Constant            | Value                       | Reason                                                                                                                                                                                                      |
| ------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_ZOOM`          | `0.05`                      | 20× overview; a 5,000-node board of 320×180 cards spanning ~40k world px fits a 1440 px viewport at ~0.036 → `fitAll` may go below `MIN_ZOOM`, so `fitAll` uses `MIN_ZOOM_FIT = 0.02` and clamps thereafter |
| `MAX_ZOOM`          | `4.0`                       | beyond 4× a 14 px card font is 56 px; no research value, and canvas text cache blows up                                                                                                                     |
| `MIN_ZOOM_FIT`      | `0.02`                      | only reachable via `fit`/`fitAll`, never via wheel                                                                                                                                                          |
| `ZOOM_SNAP_STOPS`   | `[0.1, 0.25, 0.5, 1, 2, 4]` | wheel zoom sticks within `±0.015` of a stop for one gesture tick                                                                                                                                            |
| `DOUBLE_CLICK_ZOOM` | `1.0`                       | double-click empty canvas → animate to zoom 1 at pointer                                                                                                                                                    |

### 5.3 Non-linear zoom curve

Linear zoom deltas feel wrong: `+0.1` at `zoom 0.1` doubles the scale, at `zoom 4` it is invisible.
Zoom is therefore **exponential in a normalized "zoom unit"**:

```ts
// zoom-curve.ts
const K = 320; // screen px per e-fold, tuned on trackpad
export const zoomToUnit = (z: number) => Math.log(z) * K;
export const unitToZoom = (u: number) => Math.exp(u / K);

/** delta: normalized wheel delta in px (§5.5). */
export function applyWheelZoom(z: number, deltaPx: number): number {
  const next = unitToZoom(zoomToUnit(z) - deltaPx);
  return clamp(snapNear(next, ZOOM_SNAP_STOPS, 0.015), MIN_ZOOM, MAX_ZOOM);
}
```

Anchored zoom keeps the world point under the cursor fixed:

```ts
function zoomTo(zNext: number, anchorScreen: Vec2) {
  const w = screenToWorld(anchorScreen); // BEFORE changing zoom
  camera.zoom = clamp(zNext, MIN_ZOOM, MAX_ZOOM);
  camera.x = w.x - anchorScreen.x / camera.zoom;
  camera.y = w.y - anchorScreen.y / camera.zoom;
}
```

### 5.4 Animated camera moves

`fit`, `focus`, `reset`, minimap jumps and `Ctrl+K` navigation animate; wheel/trackpad never does.
Animation: 320 ms, `cubic-bezier(0.22, 0.61, 0.36, 1)`, interpolated **in zoom-unit space**
(interpolating `zoom` linearly produces a visible speed spike at low zoom). Position is
interpolated in world space toward the target's centre. `prefers-reduced-motion: reduce` sets the
duration to 0 and jumps (N6). Any user pan/zoom/pointerdown cancels an in-flight camera animation
on the same frame.

### 5.5 Wheel / trackpad / pinch normalization

Browsers disagree on wheel units. Normalization lives in `camera/input-normalize.ts`:

```ts
export function normalizeWheel(e: WheelEvent): { dx: number; dy: number; zoomIntent: boolean } {
  let { deltaX: dx, deltaY: dy } = e;
  if (e.deltaMode === 1) {
    dx *= 16;
    dy *= 16;
  } // DOM_DELTA_LINE  → px (16px line)
  if (e.deltaMode === 2) {
    dx *= 400;
    dy *= 400;
  } // DOM_DELTA_PAGE  → px
  // Pinch on macOS/Windows trackpads arrives as ctrlKey+wheel with small deltas.
  const zoomIntent = e.ctrlKey || e.metaKey;
  if (zoomIntent) {
    dy = clamp(dy, -48, 48);
  } // guard against 100+ px spikes
  else {
    dy = clamp(dy, -240, 240);
    dx = clamp(dx, -240, 240);
  }
  return { dx, dy, zoomIntent };
}
```

Behaviour table:

| Input                                     | Effect                                                      |
| ----------------------------------------- | ----------------------------------------------------------- |
| Wheel (mouse), no modifier                | zoom at pointer (mouse-wheel users expect zoom on a canvas) |
| Wheel + `Shift`                           | horizontal pan                                              |
| Two-finger trackpad scroll (no `ctrlKey`) | pan by `(dx, dy)`                                           |
| Trackpad pinch (`ctrlKey` synthesised)    | zoom at pointer                                             |
| `Ctrl/Cmd` + wheel                        | zoom at pointer                                             |
| Touch two-finger                          | pan + pinch-zoom from the pointer-event pair (§7.2)         |

Mouse vs trackpad detection: a wheel event is classified as _trackpad_ when `deltaY` is
non-integral or `|deltaY| < 12`, latched for 700 ms. This heuristic only changes the no-modifier
default (zoom for mouse, pan for trackpad) and is user-overridable in Settings →
`canvas.wheelDefault = 'auto' | 'zoom' | 'pan'`.

The wheel listener is registered `{ passive: false }` on the container only (it must
`preventDefault()` to stop browser page zoom). All other scroll listeners in the app are passive
(`16_PERFORMANCE.md` §5.9).

### 5.6 Fit and focus

```
fit(rect, padding = 64, maxZoom = 1):
  z = min(maxZoom, (vpW - 2*padding) / rect.w, (vpH - 2*padding) / rect.h)
  z = clamp(z, MIN_ZOOM_FIT, MAX_ZOOM)
  cx = rect.x + rect.w/2 ; cy = rect.y + rect.h/2
  camera = { zoom: z, x: cx - vpW/(2z), y: cy - vpH/(2z) }
```

`focus(id)` = `fit(bounds(id) expanded by 240 world px, maxZoom 1.2)` and additionally pulses the
node's selection ring for 600 ms (`04_DESIGN_SYSTEM.md` motion token `--motion-pulse`).
`fitSelection` (`Shift+1`) fits the selection; `fitAll` (`1`) fits the scene bounds.

### 5.7 Viewport persistence

Per user, per board, in `localStorage` under `raven.viewport.<boardId>` — **not** in the Y.Doc: a
camera is personal UI state and must never sync to collaborators (`00_MASTER.md` §2, "UI state must
never be persisted" applies to shared state; personal viewport is exempted and stored outside the
document).

```ts
interface PersistedViewport {
  x: number;
  y: number;
  zoom: number;
  savedAt: number;
  v: 1;
}
```

Written throttled at 400 ms trailing and once on `pagehide`. On board open: restore if `savedAt` is
< 30 days old **and** the restored viewport intersects the scene bounds; otherwise `fitAll()`. If
the board is empty, `reset()`. A "Return to content" affordance appears whenever the viewport does
not intersect the scene bounds (`03_UX.md` §5).

---

## 6. Scene graph, spatial index and render pipeline

### 6.1 Scene graph

`SceneGraph` holds three `Map`s (`nodes`, `edges`, `groups`) plus derived structures:

- `byLayer: Map<LayerId, SortedIds>` — render order per layer, maintained with fractional z (§7.12).
- `edgesByNode: Map<NodeId, Set<EdgeId>>` — for O(deg) invalidation on node move (§8.2).
- `groupChildren: Map<GroupId, Set<NodeId>>` and `groupBounds: Map<GroupId, Rect>`.
- `sceneBounds: Rect` — maintained incrementally; recomputed fully only when a node that touched
  the bound is removed (amortised O(1), worst case O(n) on that removal).
- `dirty: { nodes: Set<NodeId>; edges: Set<EdgeId>; rects: Rect[]; full: boolean }`.

The scene graph is **flat**: groups are membership metadata, not a parent-child transform tree.
Justification: nested transforms would force a matrix stack in hit-testing and routing for a
feature (nested groups with independent transforms) the product does not have; group drag is
implemented as a multi-node move intent instead (§7.9).

### 6.2 Spatial index: choice and justification

> **Implementation note (P2).** Shipped as `src/scene/index-grid.ts` (`createGridIndex`). The cell
> constant is exported from `src/constants.ts` as `INDEX_CELL_SIZE` (value 512), not `GRID_CELL`, and
> `20_ROADMAP.md` §4's `spatial/rbush-index.ts` / "R-tree" wording is superseded by this section: no
> rbush dependency exists.

| Candidate                | Build      | Query (viewport) | Update (drag, 1 node)                                                                            | Notes                                                                                                                                             |
| ------------------------ | ---------- | ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear scan              | —          | O(n)             | O(1)                                                                                             | 5,000 AABB tests ≈ 0.35 ms/frame on the reference machine — survivable alone, but hit-test + marquee + routing all need queries, so it multiplies |
| **Uniform grid buckets** | O(n)       | O(cells + hits)  | O(1) amortised (remove+insert into ≤4 cells)                                                     | Assumes bounded object size and roughly uniform density — true here: nodes are 160–640 world px, cards cluster but do not degenerate              |
| Quadtree                 | O(n log n) | O(log n + hits)  | O(log n), rebalancing on dense clusters                                                          | Degenerates with clustered layouts (exactly our workload: imports create tight clusters); node removal requires parent merging                    |
| R-tree (bulk-loaded)     | O(n log n) | O(log n + hits)  | poor: insert/split is expensive; dynamic updates degrade quality; usually needs periodic rebuild | Best for static data + range queries                                                                                                              |

**Decision: uniform grid buckets**, cell size `GRID_CELL = 512` world px, with an overflow list for
oversized objects. Justification in one line: our dominant operation is _per-frame incremental
update during drag of up to 500 selected nodes_, where the grid is O(1) per node with no
rebalancing, while quadtree/R-tree pay logarithmic updates and structural churn for a query
advantage we cannot measure at n = 5,000. The R-tree implementation is retained in
`spatial/rtree-index.ts` **only** so `bench/spatial.bench.ts` can prove this claim per release; if
it ever wins by > 20% at the target scale, swapping is a one-line change behind
`index.contract.ts`.

### 6.3 Grid index implementation

```ts
export interface SpatialIndex {
  insert(id: EntityId, r: Rect): void;
  remove(id: EntityId): void;
  update(id: EntityId, r: Rect): void;
  queryRect(r: Rect, out: EntityId[]): EntityId[]; // fills `out`, returns it (no alloc)
  queryPoint(p: Vec2, out: EntityId[]): EntityId[];
  clear(): void;
  readonly size: number;
  stats(): { cells: number; oversized: number; maxBucket: number; avgBucket: number };
}
```

```ts
const GRID_CELL = 512;
const OVERSIZE = GRID_CELL * 4;   // objects wider/taller than this go to the overflow list

key(cx, cy) = cx * 0x100000 + cy          // int key, packed; cx,cy ∈ [-2^19, 2^19)

insert(id, r):
  if (r.w > OVERSIZE || r.h > OVERSIZE) { oversized.set(id, r); return }
  const c = cellsOf(r)                    // [cx0..cx1] x [cy0..cy1]
  for each cell: buckets.get(key).add(id)
  placement.set(id, c)                    // remembered so remove() is O(cells), not O(all cells)

update(id, r):
  const prev = placement.get(id)
  const next = cellsOf(r)
  if (sameSpan(prev, next)) return         // ~92% of drag frames hit this fast path
  removeFromCells(id, prev); insertIntoCells(id, next)

queryRect(r, out):
  for cy in [cy0..cy1], cx in [cx0..cx1]:
     b = buckets.get(key(cx,cy)); if (!b) continue
     for id of b: if (!seen.has(id) && intersects(rectOf(id), r)) { seen.add(id); out.push(id) }
  for [id, rr] of oversized: if (intersects(rr, r)) out.push(id)
  seen.clear()   // `seen` is a reused Set; cleared, never reallocated
```

**Complexity.** Insert/remove/update: O(k) where k = covered cells; with `GRID_CELL = 512` and a
max node of 640×640, k ≤ 4 for 99% of nodes. Viewport query at zoom 1 on a 1920×1080 viewport
covers `⌈1920/512⌉+1 × ⌈1080/512⌉+1 = 5 × 4 = 20` cells. At `MIN_ZOOM = 0.05` the viewport spans
38,400 × 21,600 world px = 76 × 43 = 3,268 cells — hence the **coarse-cell fallback**: when the
viewport covers more than `MAX_CELLS_PER_QUERY = 1024` cells, `queryRect` switches to a linear scan
over all entities (which at n = 5,000 is cheaper than 3,268 map lookups). Threshold verified by
`bench/spatial.bench.ts`.

Memory: one `Map<number, Set<EntityId>>`. For 5,000 nodes at typical density ≈ 1,400 buckets ≈
420 KB including the placement map. Acceptable (`16_PERFORMANCE.md` §3.1 memory budget).

Two indexes exist: `nodeIndex` (node AABBs) and `edgeIndex` (routed-path AABBs, updated when a
route resolves, §8.3). Edges are indexed because edge hit-testing (click an edge to select it,
hover to show its label) is otherwise O(edges) per pointermove.

### 6.4 Incremental update during drag

Per drag frame, for each selected node: compute the new AABB into a pooled `Rect`, call
`index.update`. With 500 selected nodes this is ≤ 500 fast-path checks ≈ 0.02 ms. Edges incident to
moved nodes are marked dirty via `edgesByNode` and re-routed off-thread (§8.2). **The index is not
rebuilt on drag**; a full rebuild happens only on `setScene` and on `bulk` patches touching > 25%
of nodes, and then it runs in `index.worker.ts` for n > 2,000 (§9.1).

### 6.5 Query APIs

> **Implementation note (P2).** The frozen interface in `src/types.ts` is `SceneQuery`:
> `nodesIn(rect)`, `nodesContainedIn(rect)`, `nodeAt(point)`, `node(id)`, `edge(id)`, `sceneBounds`,
> `nodeCount`. The `inRect`/`hitTest`/`marquee`/`nearestHandle`/`bounds` names below are the older
> sketch; handle hit-testing lives in the engine facade (`handleAt`) and edge hit-testing arrives
> with the edge index in P5.

```ts
export interface SceneQuery {
  /** Node+edge+group ids intersecting a world rect, z-ordered bottom→top. */
  inRect(r: Rect, filter?: QueryFilter): EntityId[];
  /** Topmost hit at a world point; respects locked/hidden and per-kind hit shapes. */
  hitTest(p: Vec2, opts?: { edgeTolerance?: number }): HitTarget | null;
  /** Marquee: 'touch' (any intersection) or 'contain' (fully inside). */
  marquee(r: Rect, mode: 'touch' | 'contain'): EntityId[];
  /** Nearest connectable anchor to a world point within `maxDist` world px. */
  nearestHandle(p: Vec2, maxDist: number, exclude?: NodeId): AnchorHit | null;
  bounds(ids: EntityId[]): Rect | null;
  readonly sceneBounds: Rect;
}
```

`hitTest` algorithm:

1. `nodeIndex.queryPoint(p)` → candidates; sort by (layer, z) descending; return the first whose
   **hit shape** contains `p`. Hit shapes: rounded-rect for cards (corner radius from tokens),
   the full AABB for images, and the _border band only_ (12 world px inward) for group containers,
   so clicking inside a group selects its children, not the group.
2. If no node hit: `edgeIndex.queryPoint(p expanded by tol)` → for each candidate, distance from
   `p` to the cached flattened polyline (§8.3); the closest within `tol` wins.
   `tol = max(6, 10 / zoom)` world px — a constant _screen_ tolerance of ~10 px.
3. Else: `{ kind: 'canvas' }`.

Locked nodes are hit-testable (so they can be selected and unlocked) but are not draggable (§7.7).
Hidden nodes are excluded from every query and from the index entirely.

### 6.6 Layers and frame composition

Physical layers, bottom to top:

| #   | Element              | Type     | Repaint policy                                                                                                                                                                      |
| --- | -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `canvas#grid`        | Canvas2D | repainted only on camera change; grid drawn as two `strokeRect` passes over a cell loop, or as a `createPattern` tile when `zoom ≥ 0.5`                                             |
| 1   | `canvas#scene`       | Canvas2D | edges + L0–L2 node glyphs + group containers; repainted on dirty (§6.7)                                                                                                             |
| 2   | `div#overlay`        | DOM      | the promoted L3 cards; one transformed container                                                                                                                                    |
| 3   | `canvas#interaction` | Canvas2D | selection rings, resize handles, snap/alignment guides, marquee rect, connection preview, drag ghosts, hover highlight; repainted every frame during a gesture, otherwise on demand |
| 4   | `div#chrome`         | DOM      | minimap, zoom controls, context menu, inline toolbars (owned by `apps/web`, not the engine)                                                                                         |

Splitting grid and interaction off the scene canvas means the common cases — hovering, marquee,
dragging handles — repaint only a cheap layer while the expensive scene canvas stays untouched.

### 6.7 Frame scheduling

```
scheduler.tick(now):
  if (!dirty.any && !camera.moving && !gesture.active) return          // idle: 0 work
  budget = 12ms                                                        // of the 16.6ms frame
  t0 = clock.now()

  if (camera.changed)  → repaint grid layer; mark scene FULL dirty
  if (dirty.full)      → clearRect(all); paintScene(viewportQuery)
  else                 → for each dirty rect (merged, ≤ 8 rects): clip + repaint that rect
  paintInteraction()                                                    // always cheap
  if (!gesture.active) reconcileOverlay()                               // I2: never mid-gesture
  dirty.clear()
  metrics.push(clock.now() - t0)
```

Rules that keep this within budget:

- **One rAF for the whole engine.** No component schedules its own rAF. Registered in
  `scheduler.ts` and cancelled in `dispose()`.
- **Dirty rectangles** are merged with a cheap greedy union: if merging two rects grows the total
  area by < 30%, merge. Cap 8 rects; beyond that, promote to a full repaint. Dirty-rect repaint is
  used for hover, selection change, single-node edits, and incoming collaborator patches; camera
  movement always forces a full repaint (everything moved).
- **No double buffering.** Canvas2D presentation is already double-buffered by the compositor;
  drawing to an offscreen and blitting measured 0.4–0.9 ms slower per frame in
  `bench/render.bench.ts`. Decision: draw directly, use dirty rects instead.
- **Per-node glyph bitmap cache.** L1/L2 glyphs are rasterized once per
  `(kind, accent, status, w, h, lodLevel, dpr)` tuple into an `OffscreenCanvas` and `drawImage`d.
  Cache is an LRU of 256 bitmaps (~6 MB at DPR 2). Title text is drawn _outside_ the cached bitmap
  (it is per-node) using the measurement cache (§6.9).
- **Coalesced pointer events.** `pointermove` handlers use `event.getCoalescedEvents()` only for
  freehand-style precision needs (none in v1); otherwise the last event of the frame wins. Pointer
  handling never paints synchronously — it sets state and marks dirty.
- **Frame-time metrics** are always collected (ring buffer of 240 frames) and exposed through
  `engine.metrics()`; `bench/` and the in-app debug overlay (`Ctrl+Alt+P`) read the same buffer.

### 6.8 LOD levels

> **Implementation note (P2).** Two rules cooperate. During a camera gesture the _tier_ is frozen at
> the value it had when the gesture started (this section) **and** the zoom used for glyph detail is
> quantized to `LOD_ZOOM_QUANTUM` (`20_ROADMAP.md` req 7); both are released `LOD_SETTLE_MS` after
> the last camera event. Outside a gesture the ladder applies with a ±`LOD_HYSTERESIS` dead-band.
> The dot threshold is `LOD_THRESHOLDS.glyph = 0.18` (the roadmap's "0.2" is prose, not the
> constant), and the text LRU is `TEXT_CACHE_LIMIT = 2000` entries, not 4,000.

| Level  | Zoom range           | Canvas draws per node                                                                                                                            | DOM             | Approx. cost / node       |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------------- |
| **L0** | `zoom < 0.18`        | one `fillRect`, no radius, no stroke; nodes < 2 device px are skipped entirely and their cluster is drawn as a single density blob per grid cell | none            | ~0.6 µs                   |
| **L1** | `0.18 ≤ zoom < 0.40` | cached glyph bitmap: rounded rect, 2 px accent stripe, status dot                                                                                | none            | ~1.5 µs                   |
| **L2** | `0.40 ≤ zoom < 0.55` | cached glyph bitmap + icon + one clipped line of title text (+ thumbnail for image kinds)                                                        | none            | ~4 µs (text-bound)        |
| **L3** | `zoom ≥ 0.55`        | selection ring only                                                                                                                              | full React card | DOM-bound; capped (§6.10) |

Thresholds are chosen from legibility, not taste: at `zoom = 0.55` the 13 px card title token
renders at 7.2 px — the smallest size at which the title is still recognisable, and the point at
which the DOM card stops paying for itself. At `zoom = 0.40` a 320 px card is 128 px wide: an icon
and a title fit, a body does not. At `zoom = 0.18` a card is 58 px wide: only shape and colour
survive.

**Hysteresis.** LOD switches use a ±0.02 dead-band around each threshold and require the zoom to
be stable for one frame, so slow scrolling across a boundary cannot cause per-frame
promote/demote thrash.

**Stable zoom during camera movement.** During an active camera gesture the engine freezes the LOD
level at the value it had when the gesture started and only re-evaluates 120 ms after the last
camera event (adopting tldraw's "efficient zoom level" technique). This prevents promotion storms
while the user is pinch-zooming.

### 6.9 Text rendering

- Canvas text is used **only** at L2, for one line per node. Font is set once per frame
  (`ctx.font` assignment is expensive — it triggers font matching; setting it per node cost 2.1 ms
  per 500 nodes in the benchmark). All L2 titles are drawn in a single pass with one `ctx.font`.
- **Measurement cache:** `Map<string /* text|font|maxWidth */, { w: number; clipped: string }>`,
  LRU 4,000 entries. `ctx.measureText` is called at most once per distinct tuple. Ellipsis is
  computed with a binary search over the string (≤ ⌈log2 96⌉ = 7 measurements, then cached).
- Fonts must be loaded before first canvas text: the engine awaits `document.fonts.ready` and
  calls `invalidate('font-load')` on the `loadingdone` event. Without this, the first paint uses a
  fallback metric and text visibly reflows (`16_PERFORMANCE.md` §5.14).
- All rich text, editing, selection and screen-reader output happen in the DOM at L3. The canvas
  never attempts editable text.
- Accessibility: because L0–L2 content is invisible to assistive tech, the engine maintains an
  off-screen `<ul role="listbox">` mirror of the _viewport_ node set (id, kind, title, selection
  state) updated at most every 250 ms, so keyboard/screen-reader navigation works at all zoom
  levels (N6). See `03_UX.md` §9.

### 6.10 Culling and the margin ring

```
cullRect = viewportWorld expanded by MARGIN
MARGIN   = max(256, 0.25 * viewportWorld.w) world px, capped at 2048
```

The ring means a node scrolling in from the edge was already painted/promoted before it becomes
visible, so no pop-in. During a pan gesture with velocity `v` (world px/frame) the ring is biased
in the direction of travel: `MARGIN_lead = MARGIN + min(1024, |v| * 8)`, `MARGIN_trail = MARGIN`.

DOM budget: `MAX_DOM_NODES = 260`. Rationale: a 1920×1080 viewport at `zoom = 0.55` shows
3,490×1,963 world px, which fits ~66 cards of 320×180 with gaps; 260 gives 4× headroom for dense
layouts and small cards while keeping the overlay subtree under ~5,000 DOM elements (≈ 19 elements
per card). When the promotion candidate set exceeds the budget, candidates are sorted by squared
distance from viewport centre and truncated; the remainder renders as L2 glyphs. This is a visible
but acceptable degradation and is logged as `overlay-budget-exceeded` for telemetry.

### 6.11 DOM overlay recycling pool

Mounting/unmounting cards is the single most expensive overlay operation. The pool avoids it:

```ts
class SlotPool {
  private free: HTMLElement[] = [];
  acquire(): HTMLElement {
    return this.free.pop() ?? this.createSlot();
  }
  release(el: HTMLElement) {
    el.style.transform = 'translate3d(-99999px,-99999px,0)';
    el.removeAttribute('data-node-id');
    if (this.free.length < 64) this.free.push(el);
    else el.remove();
  }
}
```

Each slot is a `position:absolute; top:0; left:0; will-change:transform; contain:layout style paint`
div positioned by `transform: translate3d(x, y, 0)` in **world** coordinates inside the scaled
overlay container. Consequences:

- During camera movement only the container's transform changes — **one** style write per frame
  regardless of how many cards are mounted (I2).
- Card size changes are `width`/`height` writes, which are rare (resize gesture end, content load).
- `contain: layout style paint` prevents a card's internal layout from invalidating siblings.
- React reconciliation happens in `OverlayHost` against the mount/unmount diff, never on camera
  change; the portal target identity is stable per slot, so React does not remount on reposition.

Pool warm-up: 48 slots created on engine init during the first idle callback.

---

## 7. Interaction: the finite state machine

### 7.1 Why an explicit FSM

Ad-hoc boolean flags (`isDragging`, `isPanning`, `isConnecting`) are how canvas apps acquire
unreproducible bugs: two flags true at once, a gesture that never ends because `pointerup` landed
on a different element, a drag that survives an `Escape`. The engine therefore has exactly **one**
state variable and all input goes through one reducer. Every transition is a pure function
`(state, event, ctx) => { next, effects[] }`, unit-testable without a DOM.

### 7.2 States

| State             | Meaning                                                         | Entry effects                                                                   | Exit effects                        |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| `idle`            | nothing in progress                                             | cursor `default`                                                                | —                                   |
| `hover`           | pointer over a hittable target                                  | cursor per target; hover highlight on interaction layer                         | clear highlight                     |
| `pan`             | camera drag (middle-drag, space-drag, trackpad-drag, hand tool) | cursor `grabbing`, pointer capture, freeze LOD                                  | unfreeze LOD after 120 ms           |
| `marquee`         | rubber-band selection                                           | capture, draw rect each frame                                                   | clear rect, emit `select`           |
| `press-pending`   | pointer down on a node, below the drag threshold                | remember origin + candidate selection                                           | —                                   |
| `drag-node`       | moving ≥ 1 node                                                 | capture, snapshot geometry, hide DOM for dragged nodes, emit `move-nodes:start` | emit `move-nodes:end`, restore DOM  |
| `resize`          | dragging a resize handle                                        | capture, snapshot, show dimension readout                                       | emit `resize-node:end`              |
| `connect`         | dragging from an anchor to a target                             | capture, show anchor field on candidates, draw preview edge                     | emit `create-edge` or discard       |
| `reconnect`       | dragging an existing edge endpoint                              | as `connect` + dim the original edge                                            | emit `reconnect-edge` or revert     |
| `edit-text`       | inline editing inside a DOM card                                | force-promote node, clamp `zoom ≥ 0.55`, disable canvas shortcuts               | commit or revert, restore shortcuts |
| `context-menu`    | menu is open                                                    | suppress hover, keep selection                                                  | close menu                          |
| `space-pan-armed` | Space held, no drag yet                                         | cursor `grab`                                                                   | cursor restore                      |
| `disabled`        | engine paused (board loading, error, presentation transition)   | ignore all input                                                                | —                                   |

Exactly one state is active. `press-pending` exists so a click and a drag share one code path and
the drag threshold is enforced in one place.

### 7.3 Events

`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `wheel`, `keydown`, `keyup`,
`blur`, `contextmenu`, `dblclick`, `dragenter/over/leave/drop` (native HTML5 DnD for files/URLs),
`paste`, plus engine-internal `camera-anim-end`, `patch-applied`, `disable`, `enable`.

### 7.4 Threshold and timing constants

```ts
export const DRAG_THRESHOLD_PX = 4; // screen px before press-pending → drag/marquee
export const CLICK_MAX_MS = 500; // longer press with no move is still a click
export const DBLCLICK_MAX_MS = 320;
export const LONG_PRESS_MS = 480; // touch: opens context menu
export const HOVER_ENTER_MS = 0; // hover is immediate…
export const HOVER_LEAVE_MS = 80; // …but leaving debounces, to survive gaps
export const EDGE_HIT_TOL_PX = 10; // screen px
export const HANDLE_HIT_PAD_PX = 6; // screen px added around 8px handles
export const ANCHOR_MAGNET_PX = 28; // screen px snap radius for connection targets
export const SNAP_TOL_PX = 6; // screen px for object/grid snapping
export const AUTOPAN_EDGE_PX = 48; // distance from viewport edge that starts auto-pan
export const AUTOPAN_MAX_SPEED = 18; // screen px per frame at the very edge
export const MULTI_DRAG_GHOST_LIMIT = 120; // above this, drag renders a bounding box only
```

All are exported so `bench/`, e2e tests and the debug overlay use the same numbers.

### 7.5 Transition table (abridged to the load-bearing rows)

| From            | Event                                     | Guard                                           | To              | Effects                                                                                                                  |
| --------------- | ----------------------------------------- | ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `idle`/`hover`  | `pointerdown` btn 0 on canvas             | no modifier                                     | `marquee`       | start rect at pointer; if no `Shift`, emit `select []`                                                                   |
| `idle`/`hover`  | `pointerdown` btn 0 on node               | node not locked                                 | `press-pending` | record origin, target, `additive = shift/meta`                                                                           |
| `idle`/`hover`  | `pointerdown` btn 0 on node               | node locked                                     | `press-pending` | select-only; drag is blocked in the guard below                                                                          |
| `idle`/`hover`  | `pointerdown` btn 1 (middle)              | —                                               | `pan`           | capture                                                                                                                  |
| `idle`/`hover`  | `pointerdown` btn 0                       | `space-pan-armed` active                        | `pan`           | capture                                                                                                                  |
| `idle`/`hover`  | `pointerdown` btn 0 on handle             | selection.size === 1                            | `resize`        | snapshot rect, record handle id                                                                                          |
| `idle`/`hover`  | `pointerdown` btn 0 on anchor             | source connectable                              | `connect`       | compute candidate anchor field                                                                                           |
| `press-pending` | `pointermove`                             | `dist > DRAG_THRESHOLD_PX` && target not locked | `drag-node`     | resolve drag set (§7.11), emit `move-nodes:start`                                                                        |
| `press-pending` | `pointermove`                             | `dist > DRAG_THRESHOLD_PX` && target **locked** | `marquee`       | locked nodes cannot be dragged; the gesture becomes a marquee                                                            |
| `press-pending` | `pointerup`                               | `elapsed < CLICK_MAX_MS`                        | `hover`         | emit `select` with the recorded mode                                                                                     |
| `drag-node`     | `pointermove`                             | —                                               | `drag-node`     | apply snapping (§7.8); emit `move-nodes:update`; auto-pan if near edge                                                   |
| `drag-node`     | `keydown Escape`                          | —                                               | `idle`          | emit `move-nodes:cancel`; restore snapshot                                                                               |
| `drag-node`     | `keydown Alt` (during drag)               | —                                               | `drag-node`     | switch to duplicate-drag: emit `duplicate-then-move` on `end`                                                            |
| `drag-node`     | `pointerup`/`pointercancel`               | —                                               | `hover`         | emit `move-nodes:end`                                                                                                    |
| `connect`       | `pointermove`                             | —                                               | `connect`       | `nearestHandle(p, ANCHOR_MAGNET_PX/zoom, sourceId)`; preview path from the routing worker's synchronous fast path (§8.1) |
| `connect`       | `pointerup` over valid target             | edge allowed by `07_EDGE_SYSTEM.md` §4          | `hover`         | emit `create-edge`                                                                                                       |
| `connect`       | `pointerup` over empty canvas             | —                                               | `hover`         | emit `create-node-from-drop` with `payload.kind='note'` and then `create-edge` (drag-to-create; `03_UX.md` §6)           |
| `connect`       | `pointerup` over invalid target           | —                                               | `hover`         | discard; flash the target red for 240 ms with the rule that failed                                                       |
| any gesture     | `pointercancel` \| `blur` \| `disable`    | —                                               | `idle`          | cancel effects, release capture, restore snapshot                                                                        |
| `hover`         | `dblclick` on node                        | node editable                                   | `edit-text`     | promote, focus the card's editor                                                                                         |
| `edit-text`     | `keydown Escape` \| outside `pointerdown` | —                                               | `hover`         | commit (Escape reverts, click-away commits — matches `03_UX.md` §7)                                                      |
| any             | `contextmenu`                             | —                                               | `context-menu`  | emit `context-menu` with the hit target; the _selection is not changed_ if the target is already selected                |

**Cancellation is universal.** `pointercancel`, window `blur`, tab hide (`visibilitychange`),
`Escape`, and `engine.disable()` all route to the same `abortGesture()` routine, which: releases
pointer capture, restores the pre-gesture geometry snapshot, emits `phase: 'cancel'`, clears the
interaction layer and returns to `idle`. There is exactly one implementation of this routine.

**Pointer capture.** On entering any capturing state, `container.setPointerCapture(e.pointerId)` is
called on the _container_, never on a card. Capturing on the container is what makes drags survive
a card being unmounted mid-gesture (which happens when a collaborator deletes it) and what makes
`pointerup` outside the window still arrive.

### 7.6 `edit-text` specifics

Entering `edit-text` force-promotes the node to DOM regardless of the budget, animates the camera
to `zoom = max(zoom, 0.55)` if needed (200 ms), and installs a shortcut shield: while editing, only
`Escape`, `Ctrl+Z/Y` (handled by the editor's own local history — the Y.UndoManager scope is the
text type, see §8.4), and `Tab` reach the engine. Every other engine key binding is suspended.

### 7.7 Locking and hiding

- `locked`: selectable, inspectable, not movable/resizable/deletable; the resize handles are not
  drawn; the drag guard converts a drag attempt into a marquee (row 11 above) so the user is not
  stuck. A lock badge is drawn on the selection ring.
- `hidden`: removed from the spatial index, not painted, not hit-testable, not exported to the
  viewport a11y mirror. Only reachable from the Layers panel (`03_UX.md` §11).
- Locking a group locks its children by inheritance; the child's own `locked` flag is unchanged, so
  unlocking the group restores the previous per-child state.

### 7.8 Snapping and guides

Three independent, separately toggleable systems, all evaluated only for the **dragged bounding
box** (not per node — with 500 selected nodes per-node snapping is both wrong and slow):

1. **Grid snap** (`Ctrl+'` toggles; off by default). Snaps the drag box's top-left to a multiple of
   `GRID_SNAP = 8` world px. Cost O(1).
2. **Object snap** (on by default). Candidate lines come from nodes within the viewport plus a
   256 px margin, capped at the 400 nearest (`nodeIndex.queryRect` + partial sort). For each
   candidate: 3 vertical lines (left, centre-x, right) and 3 horizontal (top, centre-y, bottom).
   The dragged box contributes the same 6 lines. A snap fires when
   `|a - b| * zoom ≤ SNAP_TOL_PX`; the smallest-delta candidate per axis wins; ties break toward
   the nearest node. Cost O(400 × 6) = 2,400 comparisons ≈ 0.05 ms.
3. **Distribution guides.** When ≥ 3 nodes share an axis and the gaps between consecutive
   neighbours are equal within `SNAP_TOL_PX`, the engine offers the position that continues the
   rhythm, and draws the classic double-arrow gap indicators with the pixel value.

Guides are drawn on the interaction layer as 1 px lines in `--color-guide` (magenta-free; token
per `04_DESIGN_SYSTEM.md`), extending 24 px past the involved bounds, with the matched value
rendered at the midpoint when `zoom ≥ 0.4`. Holding `Ctrl` (or `Cmd`) during a drag suspends all
snapping for that frame. Snapping never applies during `resize` on the free-corner handle when
`Alt` is held (proportional-from-centre resize).

### 7.9 Alignment, distribution, grouping

`align(ids, axis)` where axis ∈ `left|centre-x|right|top|centre-y|bottom`: computed against the
selection bounding box, except when exactly one node is "primary" (the last-clicked), in which case
it is the reference and does not move. `distribute(ids, 'h'|'v')` requires ≥ 3 nodes and equalises
gaps between bounding boxes (not centres), keeping the two extremes fixed.

Grouping: `group(ids)` emits an intent; the host creates a `GroupView` whose bounds are the union
of children plus 16 world px padding and a 28 px header band. Group drag moves all children
(`move-nodes` with the full child set). Group bounds recompute on any child geometry change,
debounced to the end of the gesture. Groups may not nest in v1 (see §12 R6).

### 7.10 Z-order and layers

Z is a **fractional index** (`z: number`, initially spaced by 1024). `bringForward` computes the
midpoint between the node and the next one above; when the gap underflows `1e-6`, the layer is
renormalised (reassign integers 0..n-1) and the renormalisation is emitted as a single bulk intent.
Rationale: fractional indices make concurrent reordering merge sanely in a CRDT, where index-shift
operations do not.

Layers (`LayerView { id, name, visible, locked, order }`) are a user-facing grouping for
visibility/lock; render order is `(layer.order, node.z)`. Default board has one layer, `Base`.

### 7.11 Selection semantics

```ts
interface SelectionController {
  readonly ids: ReadonlySet<EntityId>;
  readonly primary: EntityId | null;      // last added; reference for alignment
  set(ids: EntityId[]): void; add(...): void; toggle(...): void; subtract(...): void;
  clear(): void; all(): void; invert(): void;
  selectSameKind(): void;                 // Ctrl+Shift+A
  grow(): void;                           // add directly-connected neighbours (Ctrl+G is group; this is Alt+])
}
```

- Click = replace. `Shift`+click = toggle. `Alt`+click = subtract. Marquee replaces unless `Shift`
  (add) or `Alt` (subtract) is held at gesture start.
- Marquee mode: **touch** by default (any intersection); hold `Ctrl` for **contain**.
- Dragging a node that is _not_ in the selection replaces the selection with that node first;
  dragging a node that _is_ in the selection drags the whole selection.
- Selection of an edge and a node simultaneously is allowed; operations apply where meaningful.
- Selection is ephemeral UI state (Zustand, `00_MASTER.md` §2) but is mirrored into Yjs awareness
  for presence highlighting (`08_DATA_MODEL.md` §7).
- Above `MULTI_DRAG_GHOST_LIMIT = 120` nodes, the drag renders only the bounding box + count badge
  instead of per-node ghosts.

### 7.12 Keyboard

The engine owns canvas-scoped keys only; global shortcuts live in `apps/web`
(`03_UX.md` §13 is the authoritative full list). Engine-owned: arrows (nudge 1 px / `Shift` 10 px),
`Space` (pan latch), `Escape` (cancel/clear), `Delete`/`Backspace`, `Ctrl+A`, `Tab`/`Shift+Tab`
(cycle nodes in reading order within the viewport, moving the camera as needed — N6),
`Enter` (edit primary), `[`/`]` (z-order), `Ctrl+D` (duplicate at +24,+24 world px),
`0` (fit all), `1` (zoom 100%), `2` (fit selection), `+`/`-` (zoom step at viewport centre).

---

## 8. Edge rendering and the routing worker

### 8.1 Split of responsibilities

Routing **algorithms** (curved, orthogonal with obstacle avoidance, smart anchor choice) are pure
functions in `packages/domain/src/routing/*` and are specified in `07_EDGE_SYSTEM.md` §5. The
canvas engine owns only _when_ they run, _where_ they run, and _how results are cached_.

Two execution paths:

| Path            | When                                                                                  | Where                                              |
| --------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Fast path**   | `straight`, `curved` (cubic bezier from anchors) — closed-form, ≤ 2 µs                | main thread, inline, never cached beyond the frame |
| **Worker path** | `orthogonal` and `smart` — obstacle-aware A\*/visibility routing, 20 µs–3 ms per edge | `routing.worker.ts`                                |

The connection preview during `connect` always uses the fast path (a bezier), even when the target
routing mode is orthogonal, so the preview can never stutter; the real route resolves on drop.

### 8.2 Invalidation

An edge's route is invalidated when: either endpoint node moves or resizes; either anchor spec
changes; the edge's routing mode or style changes; an **obstacle** node inside the route's
inflated AABB moves (orthogonal/smart only).

Obstacle tracking: when the worker returns a route it also returns `obstacleIds` — the nodes it
considered. The engine stores a reverse map `obstacleId → Set<EdgeId>`. On a node move, invalidate
`edgesByNode(id) ∪ obstacleEdges(id)`. To keep this bounded during a 500-node drag, obstacle-driven
invalidation is **deferred to gesture end**; during the drag, orthogonal edges attached to moving
nodes are drawn with the fast-path bezier ("degraded route", visually flagged by 85% opacity), and
the real routes are recomputed once on `pointerup`. This is the single most important performance
decision in edge rendering: it converts a potentially 10,000-edge reroute per frame into one batch
at the end of a gesture (`16_PERFORMANCE.md` §4.2 scenario "10k edge reroute").

### 8.3 Route cache

```ts
interface RoutedPath {
  edgeId: EdgeId;
  /** Flattened polyline in world px, Float32Array [x0,y0,x1,y1,…]; used for hit-testing + AABB. */
  points: Float32Array;
  /** Ready-to-stroke path. Built lazily on first paint from `points` + routing mode. */
  path2d: Path2D | null;
  aabb: Rect;
  obstacleIds: NodeId[];
  version: number; // == edge.visualVersion + endpoint versions, for staleness checks
  labelAnchor: Vec2; // point at 50% arc length, used for label placement
}
```

- Stored in `Map<EdgeId, RoutedPath>`, capacity-unbounded but pruned with the scene (an edge's
  entry dies with the edge).
- `Path2D` objects are **pooled and rebuilt** rather than kept for every edge: keeping 10,000
  `Path2D` instances measured ~34 MB. Instead `path2d` is built on first paint and dropped when
  the edge leaves the cull rect for > 2 s (weak cache, §10.2).
- A stale route (version mismatch) is still drawn, dimmed to 85% opacity, until the worker replies.
  Never blank an edge waiting for a route.
- `edgeIndex.update(edgeId, aabb)` runs whenever a route resolves.

### 8.4 Batching and backpressure to the worker

Requests are coalesced per frame into one message:

```ts
type RouteRequest = {
  reqId: number;
  edges: Array<{
    id: EdgeId;
    from: Rect;
    to: Rect;
    fromAnchor: AnchorSpec;
    toAnchor: AnchorSpec;
    mode: RoutingMode;
  }>;
  obstacles: Float32Array; // [id32, x, y, w, h] × n, transferable
  viewport: Rect; // worker prioritises visible edges first
  budgetMs: number; // worker returns partial results when exceeded
};
```

The worker processes visible edges first, returns partial results within `budgetMs = 8`, and
continues in follow-up messages. If a new request arrives while one is in flight, the in-flight
`reqId` is cancelled (the worker checks a `SharedArrayBuffer` cancel flag between edges when
cross-origin isolation is available, otherwise between chunks — see §9.3). At most **one**
outstanding request per engine; superseded requests are dropped, never queued (queuing produces the
classic "routes keep arriving for positions the user already left" artefact).

---

## 9. Undo/redo integration

The engine has **no history of its own**. `Y.UndoManager` in `apps/web` is the single history
(`00_MASTER.md` §2).

- **Transaction boundaries.** The host wraps document writes in `ydoc.transact(fn, LOCAL_ORIGIN)`.
  The UndoManager is constructed with `trackedOrigins: new Set([LOCAL_ORIGIN])` so remote and
  projection-driven changes are never undone by the local user (N3).
- **One gesture = one undo step.** On `phase:'start'` the host calls `undoManager.stopCapturing()`
  (closing any previous item), then applies every `update` inside transactions within the
  `captureTimeout` window. `captureTimeout` is set to `500` ms — long enough to merge a continuous
  drag, short enough that two deliberate drags are two undo steps. On `phase:'end'` the host calls
  `stopCapturing()` again to seal the item.
- **Cancel** (`phase:'cancel'`) does _not_ create an undo item: the host re-applies the snapshot it
  captured at `start` inside a transaction with the **same** origin and then calls
  `undoManager.stopCapturing()`; because the net effect is identity, the item is empty and Yjs
  discards it. Verified by `undo-cancel.test.ts`.
- **Text editing** is tracked by a _separate_ UndoManager scoped to that node's `Y.Text`, so
  `Ctrl+Z` inside an editor undoes typing, not the previous canvas drag. On exiting `edit-text`
  the scoped manager is disposed and its stack discarded.
- **Tool imports and AI proposals** (N3, N4) apply as one transaction each, so accepting a
  200-node SpiderFoot import is a single undo step. The engine is uninvolved beyond receiving the
  resulting `bulk` patch.
- **Camera is never undoable.** Camera intents bypass the document entirely. `Ctrl+Z` after a pan
  must undo the last _edit_, which is what analysts expect from every professional tool.

---

## 10. Worker architecture

### 10.1 What runs off the main thread

| Work                                                      | Worker                                                          | Trigger                                              | Why off-thread                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Orthogonal/smart edge routing                             | `routing.worker`                                                | endpoint/obstacle invalidation, gesture end          | 10k edges × ~0.3 ms would be seconds                                              |
| Auto-layout (force, hierarchical, grid, radial, timeline) | `layout.worker`                                                 | user command, `14_AI_AGENT.md` cluster apply         | force layout is iterative and unbounded                                           |
| Bulk spatial index rebuild                                | `index.worker`                                                  | `setScene` with n > 2,000; bulk patch > 25% of nodes | 5,000 inserts ≈ 6 ms; would drop a frame on board open                            |
| Full-text/fuzzy in-board search index                     | `index.worker`                                                  | board open, debounced content change                 | building a trigram index over 5,000 nodes blocks input                            |
| Thumbnail decode + downscale                              | main thread `createImageBitmap` (already off-thread internally) | image node load                                      | `createImageBitmap` decodes off the main thread already; a worker adds no benefit |

Rendering does **not** move to a worker (option 6, §1).

### 10.2 Protocol

One typed RPC wrapper (`workers/protocol.ts`) over `postMessage`, with request ids, cancellation
tokens, structured error propagation, and zod validation **in development only** (validation is
compiled out in production via `import.meta.env.DEV` to avoid the parse cost on hot messages).

```ts
type Req =
  | { k: 'route'; id: number; payload: RouteRequest }
  | { k: 'layout'; id: number; payload: LayoutRequest }
  | { k: 'index-build'; id: number; payload: IndexBuildRequest }
  | { k: 'search-build'; id: number; payload: SearchBuildRequest }
  | { k: 'cancel'; id: number };

type Res =
  | { k: 'route:partial'; id: number; routes: PackedRoutes }
  | { k: 'route:done'; id: number }
  | { k: 'layout:tick'; id: number; positions: Float32Array; iteration: number }
  | { k: 'layout:done'; id: number; positions: Float32Array }
  | { k: 'index:done'; id: number; cells: Uint32Array; ids: Uint32Array }
  | { k: 'error'; id: number; code: string; message: string };
```

### 10.3 Transferable data formats

**Decision: `ArrayBuffer` transfer (zero-copy `postMessage` with a transfer list), not
`SharedArrayBuffer`, as the baseline.** Justification: `SharedArrayBuffer` requires cross-origin
isolation (`COOP: same-origin`, `COEP: require-corp`), which breaks embedded third-party content
(link previews via iframes, external images without CORP headers) — a core Raven feature. Transfer
is zero-copy for the buffer itself and is sufficient at our data volumes.

Encodings (all little-endian, defined once in `protocol.ts`):

- **Node geometry** → `Float32Array`, stride 5: `[idIndex, x, y, w, h]`, with a parallel
  `ids: string[]` sent once per scene generation and referenced by index thereafter. 5,000 nodes =
  100 KB, transferred in ~0.05 ms.
- **Routes (`PackedRoutes`)** → `{ offsets: Uint32Array, points: Float32Array, ids: Uint32Array }`,
  a single flat point buffer with per-edge offsets. 10,000 edges × avg 6 points = 480 KB.
- **Layout positions** → `Float32Array` stride 3: `[idIndex, x, y]`.

`SharedArrayBuffer` is used **only** for the 4-byte cancellation flag, and only when
`crossOriginIsolated === true`; the fallback is chunked cancellation checks (the worker processes
edges in chunks of 64 and drains its message queue between chunks). Behaviour is identical, only
cancel latency differs (≤ 0.2 ms vs ≤ 20 ms).

### 10.4 Pool and backpressure

- One dedicated `routing.worker` (routing is inherently serialised by the cancel-supersede rule).
- One `layout.worker`, restarted per run (layout runs are long; termination is the cancel).
- One shared `index.worker` for index + search builds, FIFO.
- Workers are created lazily on first use and terminated after 60 s idle to free ~4 MB each; they
  are recreated transparently.
- **Backpressure rules:** at most one in-flight request per worker; new requests supersede; if a
  worker fails to respond within 5 s it is terminated and restarted, the request is retried once,
  and on a second failure the engine falls back to the main-thread implementation with a degraded
  route mode and emits `engine:worker-degraded` for telemetry. Never silently do nothing.
- Worker errors never reach the user as a raw exception; they surface as a toast per
  `03_UX.md` §12 ("Edge routing is running in reduced quality — retry").

---

## 11. Memory management

### 11.1 Pools

| Pool                | Size                       | Contents                                                                     |
| ------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `Rect` pool         | 512                        | scratch rects for queries, AABB math; `withRect(fn)` scoped borrow           |
| `Vec2` pool         | 256                        | pointer math                                                                 |
| Query result arrays | 8 arrays × pre-sized 4,096 | `queryRect(out)` fills caller-provided arrays; no allocation in the hot path |
| `Path2D` pool       | 256                        | edge paths, rebuilt not retained (§8.3)                                      |
| DOM slot pool       | 64                         | overlay slots (§6.11)                                                        |

Hot-path allocation rule: `queryRect`, `hitTest`, `update`, the FSM reducer and every layer's paint
function must allocate **zero** objects per call. Verified by `bench/alloc.bench.ts`, which runs
1,000 frames with `--expose-gc` and asserts heap growth < 256 KB.

### 11.2 Weak caches

- Glyph bitmaps: LRU 256, byte-accounted, hard cap 12 MB; evicts least-recently-drawn.
- Text measurements: LRU 4,000 entries (~600 KB).
- Thumbnails (`ImageBitmap`): LRU by bytes, hard cap 64 MB; `ImageBitmap.close()` on eviction
  (failing to call `close()` leaks GPU memory that GC will not reclaim promptly — this is the
  most likely leak in the whole engine).
- Routed paths: keyed by edge id, dropped with the edge; `Path2D` field cleared after 2 s
  off-screen.
- `WeakRef` + `FinalizationRegistry` are used only for the thumbnail cache's debug accounting,
  never for correctness.

### 11.3 Teardown checklist

`dispose()` must, in this order, and `teardown.ts` maintains a registry so nothing is forgotten:

1. Cancel the rAF handle; set `disposed = true` so any late callback returns immediately.
2. Abort any active gesture (release pointer capture).
3. Terminate all workers; reject pending RPCs with `EngineDisposed`.
4. Disconnect `ResizeObserver`, `IntersectionObserver`, `document.fonts` listener, `matchMedia`
   listeners (reduced-motion, DPR change).
5. Remove every listener via the single `AbortController` the engine registers all listeners with
   (`{ signal }` on every `addEventListener` — no manual `removeEventListener` anywhere).
6. `unmount` every overlay slot, clear the pool, remove the overlay root.
7. Close every `ImageBitmap`, clear all caches, set canvas `width = height = 0` (this releases the
   backing store immediately; simply dropping the reference does not).
8. Clear scene maps, indexes, pools.
9. Clear the persisted-viewport throttle timer.

### 11.4 Leak tests

`tests/leaks.test.ts`, run in CI with `--expose-gc`:

- Mount/dispose the engine 50× with a 1,000-node scene; assert `performance.memory.usedJSHeapSize`
  growth < 8 MB and `document.querySelectorAll('canvas').length === 0`.
- Open/close 20 boards; assert worker count returns to 0 and listener count (tracked via a dev-only
  `addEventListener` counter) returns to baseline.
- Pan for 600 synthetic frames; assert heap growth < 2 MB (catches per-frame allocation).
- Promote/demote 500 nodes 20×; assert slot pool size ≤ 64 and no detached DOM nodes
  (Playwright + CDP `Memory.getAllTimeSamplingProfile` heuristics; see `18_TESTING.md` §8).

---

## 12. Testing hooks

### 12.1 Deterministic clock

```ts
export interface EngineClock {
  now(): number;
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(h: number): void;
}
export class TestClock implements EngineClock {
  // testing/clock.ts
  advance(ms: number): void; // runs due frames deterministically
  step(frames = 1, dt = 16.667): void;
}
```

Every time reference inside the engine goes through the clock. `performance.now()` and
`requestAnimationFrame` appear exactly once in the codebase, in the default clock — enforced by an
ESLint `no-restricted-globals` rule scoped to `packages/canvas-engine`.

### 12.2 Synthetic input

```ts
const io = synthetic(engine);
io.pointer
  .down({ x: 100, y: 100, button: 0 })
  .move({ x: 160, y: 140 }, { steps: 6 }) // emits 6 interpolated pointermove events
  .up();
io.wheel({ dy: -120, ctrlKey: true, x: 400, y: 300 });
io.key('Escape');
expect(engine.debug.state).toBe('idle');
```

Synthetic input constructs real `PointerEvent`s with correct `pointerId`/`buttons` and dispatches
through the same listeners as production, so the FSM is exercised end-to-end without Playwright.

### 12.3 Headless scene snapshots

`testing/headless.ts` renders a scene into a node-canvas 2D context and produces:

- a **structural snapshot** — a stable JSON of what the engine decided to draw
  (`{ lod, culledIn: string[], domPromoted: string[], edgesRouted: number, dirtyRects: Rect[] }`).
  This is the primary assertion surface; it is deterministic and diff-readable, unlike pixels.
- a **pixel snapshot** (PNG) for a small set of golden cases, compared with a 0.1% pixel tolerance.
  Pixel goldens live in `packages/canvas-engine/tests/__snapshots__/` and are regenerated only
  with an explicit flag.

`engine.debug` (dev builds only, tree-shaken in production) exposes: `state`, `selection`,
`camera`, `index.stats()`, `frameMetrics`, `overlay.mounted`, `routes.pending`, and
`forceLod(level)` for testing LOD paths without zooming.

---

## Open risks

| #   | Risk                                                                                                                                                            | Impact                                       | Mitigation / trigger                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The 260-node DOM budget is exceeded on legitimately dense boards (small cards, high zoom-out on a 4K display), degrading a visible region to L2 glyphs          | Perceived as "cards lost their content"      | Budget is a constant, benchmarked per release on the 4K profile (`16_PERFORMANCE.md` §3.1); raise only with a passing bench. Telemetry event `overlay-budget-exceeded` tells us if it happens in the field                        |
| R2  | Uniform-grid degeneracy: a user piles 3,000 nodes into one 512 px cell (e.g. an import that fails to lay out), turning queries into linear scans of that bucket | Frame spikes on hover/marquee                | `index.stats().maxBucket` is asserted in bench; if `maxBucket > 256`, the engine logs and the import pipeline is required to pre-layout (`10_INTEGRATIONS.md` §9). A quadtree swap behind `index.contract.ts` is the escape hatch |
| R3  | Canvas/DOM sub-pixel drift on browsers with fractional DPR (1.25, 1.5)                                                                                          | Shimmering rings, 1 px misalignment          | `overlay-alignment.spec.ts` runs at DPR 1, 1.25, 1.5, 2, 3; failures block the build                                                                                                                                              |
| R4  | Deferring obstacle-aware rerouting to gesture end (§8.2) means orthogonal edges look "wrong" mid-drag                                                           | Cosmetic, but analysts may read it as a bug  | Degraded routes are drawn at 85% opacity, which is a deliberate, documented visual signal (`03_UX.md` §6); revisit if user testing reads it as breakage                                                                           |
| R5  | `SharedArrayBuffer` unavailability (no cross-origin isolation, §10.3) raises cancel latency to ~20 ms                                                           | Slightly stale routes after fast gestures    | Acceptable; measured. Revisit only if link previews move out of iframes                                                                                                                                                           |
| R6  | Groups do not nest and nodes do not rotate in v1                                                                                                                | Feature gap versus whiteboard expectations   | Deliberate: both would require a transform tree in hit-testing, routing and snapping. Adding them later is a scene-graph change (§6.1) confined to `scene/` and `spatial/`                                                        |
| R7  | Long text at L2 makes the glyph pass text-bound (~4 µs/node)                                                                                                    | 500 visible nodes ≈ 2 ms of the 12 ms budget | Titles pre-truncated to 96 chars by the host; single `ctx.font` set per frame; measurement cache. If it regresses, drop titles at L2 for `zoom < 0.47`                                                                            |
| R8  | Safari's `OffscreenCanvas`/`ImageBitmap` behaviour for the glyph cache differs enough to change costs                                                           | Slower L1/L2 on Safari                       | Feature-detect; fall back to a hidden `<canvas>` as the cache surface. Benched in the Safari CI lane (`18_TESTING.md` §4)                                                                                                         |
| R9  | The engine's intent-only design means one extra hop (intent → Y.Doc → patch → render) on every drag frame                                                       | Added latency if the host is slow            | Budget: host round-trip ≤ 2 ms p95, asserted in `bench/interaction.bench.ts`. If exceeded, the engine may render an optimistic local transform for the drag set only, reconciled on patch                                         |
