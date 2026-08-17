/**
 * The engine's shared vocabulary. Every module in this package imports its types from here so the
 * public surface stays one file wide (05_CANVAS_ENGINE.md §3).
 *
 * Nothing in this file touches the DOM, React or the network: the engine is a pure rendering and
 * interaction module (05 §3, N-rules in 00_MASTER.md §4).
 */

export type NodeId = string;
export type EdgeId = string;
export type GroupId = string;
export type LayerId = string;
/** All entity ids are plain strings today; the union documents intent for readers and future branding. */
// eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents
export type EntityId = NodeId | EdgeId | GroupId;

export interface Vec2 {
  x: number;
  y: number;
}

/** Top-left anchored, world px unless the field name says screen. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Premultiplied nothing: plain sRGB with alpha 0..1, resolved from tokens by the host. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/* ------------------------------------------------------------------ camera */

/** `x`/`y` is the world coordinate of the container's top-left corner (05 §4). */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export type CameraCause = 'user' | 'fit' | 'focus' | 'minimap' | 'restore' | 'reset';

export interface CameraController {
  readonly state: Readonly<CameraState>;
  panBy(dxScreen: number, dyScreen: number): void;
  zoomTo(zoom: number, anchorScreen: Vec2, opts?: { animate?: boolean }): void;
  /** `steps` are zoom-curve units, not multipliers (05 §5.3). */
  zoomBy(steps: number, anchorScreen: Vec2): void;
  fit(rect: Rect, opts?: { padding?: number; maxZoom?: number; animate?: boolean }): void;
  fitAll(opts?: { padding?: number; animate?: boolean }): void;
  focus(id: EntityId, opts?: { zoom?: number; animate?: boolean }): void;
  reset(): void;
  screenToWorld(p: Vec2): Vec2;
  worldToScreen(p: Vec2): Vec2;
  readonly viewportWorld: Rect;
}

/* ------------------------------------------------------------------- scene */

export type NodeKind = string;
export type IconGlyphId = string;
export type NodeStatus = 'none' | 'running' | 'error' | 'stale';

/** Everything needed to paint LOD levels 0–2 without reading the domain payload (05 §3.2). */
export interface NodeGlyph {
  accent: RGBA;
  fill: RGBA;
  icon: IconGlyphId;
  /** Host truncates to ≤ 96 chars; the engine additionally hard-truncates at draw time. */
  title: string;
  badgeCount: number;
  thumbnailKey: string | null;
  status: NodeStatus;
}

export interface NodeView {
  id: NodeId;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fractional index within the layer; higher paints later. */
  z: number;
  layerId: LayerId;
  groupId: GroupId | null;
  /** Reserved: nodes never rotate in v1 (05 §12 R7). */
  rotation: 0;
  locked: boolean;
  hidden: boolean;
  glyph: NodeGlyph;
  /** Opaque handle the host uses to render the DOM card; the engine never inspects it. */
  domKey: string;
  /** Monotonic; bump to invalidate this node's paint cache. */
  visualVersion: number;
}

/** P5 replaces the anchor resolution; the shape is frozen now so edges can be routed later. */
export interface AnchorSpec {
  side: 'top' | 'right' | 'bottom' | 'left' | 'auto';
  /** 0..1 along the side; ignored when `side` is 'auto'. */
  t: number;
}

export interface EdgeStyle {
  color: RGBA;
  width: number;
  dash: readonly number[] | null;
  arrowStart: boolean;
  arrowEnd: boolean;
  opacity: number;
}

export interface EdgeView {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  fromAnchor: AnchorSpec;
  toAnchor: AnchorSpec;
  /** P2 paints every routing as 'straight'; P5 implements the rest behind this same field. */
  routing: 'straight' | 'curved' | 'orthogonal' | 'smart';
  style: EdgeStyle;
  label: string | null;
  z: number;
  hidden: boolean;
  visualVersion: number;
}

export interface GroupView {
  id: GroupId;
  title: string;
  color: RGBA;
  collapsed: boolean;
  z: number;
}

export interface LayerView {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface SceneSnapshot {
  nodes: NodeView[];
  edges: EdgeView[];
  groups: GroupView[];
  /** Ordered bottom→top. */
  layers: LayerView[];
}

export type ScenePatch =
  | { op: 'upsert-node'; node: NodeView }
  | { op: 'remove-node'; id: NodeId }
  | { op: 'move-nodes'; moves: Array<{ id: NodeId; x: number; y: number }> }
  | { op: 'resize-node'; id: NodeId; w: number; h: number; x?: number; y?: number }
  | { op: 'upsert-edge'; edge: EdgeView }
  | { op: 'remove-edge'; id: EdgeId }
  | { op: 'upsert-group'; group: GroupView }
  | { op: 'remove-group'; id: GroupId }
  | { op: 'set-layers'; layers: LayerView[] }
  | { op: 'bulk'; patches: ScenePatch[] };

/* --------------------------------------------------------------- hit tests */

export type HitTarget =
  | { t: 'node'; id: NodeId }
  | { t: 'edge'; id: EdgeId }
  | { t: 'handle'; id: NodeId; handle: ResizeHandle }
  | { t: 'port'; id: NodeId; anchor: AnchorSpec }
  | { t: 'canvas' };

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface SceneQuery {
  /** Nodes whose bounds intersect `rect`, bottom→top. */
  nodesIn(rect: Rect): NodeView[];
  /** Nodes fully contained in `rect` (marquee alt mode). */
  nodesContainedIn(rect: Rect): NodeView[];
  /** Topmost hit at a world point, or null. */
  nodeAt(p: Vec2): NodeView | null;
  node(id: NodeId): NodeView | undefined;
  edge(id: EdgeId): EdgeView | undefined;
  readonly sceneBounds: Rect;
  readonly nodeCount: number;
}

/* --------------------------------------------------------------- selection */

export type SelectionMode = 'replace' | 'add' | 'toggle' | 'subtract';

export interface SelectionController {
  /** Insertion-ordered; the last entry is the alignment anchor (05 §7.11). */
  readonly ids: readonly EntityId[];
  readonly anchor: EntityId | null;
  has(id: EntityId): boolean;
  set(ids: readonly EntityId[], mode?: SelectionMode): void;
  clear(): void;
  selectAll(): void;
  /** Union of the selected nodes' bounds, or null when nothing node-like is selected. */
  bounds(): Rect | null;
}

/* ----------------------------------------------------------------- intents */

export type GesturePhase = 'start' | 'update' | 'end' | 'cancel';
export type AlignAxis = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface DropPayload {
  kind: 'text' | 'url' | 'files';
  text?: string;
  files?: readonly File[];
}

export type Intent =
  | { t: 'select'; ids: EntityId[]; mode: SelectionMode }
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

export type Unsubscribe = () => void;

export interface EngineEvents {
  intent: (intent: Intent) => void;
  selectionChanged: (ids: readonly EntityId[]) => void;
  cameraChanged: (camera: Readonly<CameraState>, cause: CameraCause) => void;
  hoverChanged: (target: HitTarget) => void;
  /** Emitted once per painted frame with timing, for the bench harness. */
  frame: (stats: FrameStats) => void;
}

export interface FrameStats {
  /** ms spent inside the frame callback. */
  duration: number;
  paintedNodes: number;
  paintedEdges: number;
  mountedHosts: number;
  lod: LodLevel;
}

/* ------------------------------------------------------------------- theme */

/** Resolved design tokens. The engine never reads CSS variables at draw time (05 §3.1). */
export interface EngineTheme {
  canvasBackground: RGBA;
  gridDot: RGBA;
  gridLine: RGBA;
  nodeFill: RGBA;
  nodeStroke: RGBA;
  nodeTitle: RGBA;
  selectionStroke: RGBA;
  marqueeStroke: RGBA;
  marqueeFill: RGBA;
  guideStroke: RGBA;
  edgeStroke: RGBA;
  minimapViewport: RGBA;
  minimapNode: RGBA;
  /** CSS font shorthand used for canvas-painted titles. */
  titleFont: string;
  /** Selection outline width in screen px at any zoom. */
  selectionWidth: number;
}

export interface EngineFeatures {
  grid: boolean;
  snapToGrid: boolean;
  alignmentGuides: boolean;
  minimap: boolean;
  inertialPan: boolean;
  debugOverlay: boolean;
}

/* --------------------------------------------------------- clock and frames */

/**
 * Injected time and frame source. Tests pass a manual clock and drive frames by hand
 * (18_TESTING.md §5.2); the browser default wraps rAF + performance.now.
 */
export interface EngineClock {
  now(): number;
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(handle: number): void;
  /** Trailing timers (viewport persistence, LOD quantization release). */
  setTimer(cb: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

/* ----------------------------------------------------------------- overlay */

export interface OverlayDiff {
  mount: Array<{ id: NodeId; domKey: string; slot: HTMLElement; rect: Rect }>;
  update: Array<{ id: NodeId; slot: HTMLElement; rect: Rect }>;
  unmount: Array<{ id: NodeId; slot: HTMLElement }>;
}

export interface OverlayRenderer {
  /** Called at most once per frame with the exact promotion diff. */
  sync(diff: OverlayDiff): void;
  setTransform(t: { x: number; y: number; scale: number }): void;
}

/* ------------------------------------------------------------ render seam */

export type LodLevel = 'dom' | 'glyph' | 'dot';

export type InvalidateReason = 'theme' | 'dpr' | 'font' | 'resize' | 'scene' | 'camera';

/**
 * The single seam that lets the whole render pipeline run in Node against a recording target
 * (18_TESTING.md §5.1). A browser target wraps a real 2D context; the recording target appends
 * draw calls to an array that snapshot tests assert on.
 */
export interface RenderTarget {
  /** CSS px size of the drawing surface. */
  readonly size: { width: number; height: number };
  readonly dpr: number;
  resize(width: number, height: number, dpr: number): void;
  beginFrame(): DrawContext;
  endFrame(): void;
  dispose(): void;
}

/**
 * The drawing verbs the layers are allowed to use. Deliberately smaller than
 * CanvasRenderingContext2D: a small verb set is what makes the recording target and the scene
 * snapshots readable.
 */
export interface DrawContext {
  clear(color: RGBA): void;
  save(): void;
  restore(): void;
  /** Camera transform, applied once per frame. */
  setCamera(camera: CameraState): void;
  rect(rect: Rect, fill: RGBA | null, stroke: RGBA | null, strokeWidth?: number): void;
  roundRect(
    rect: Rect,
    radius: number,
    fill: RGBA | null,
    stroke: RGBA | null,
    strokeWidth?: number,
  ): void;
  line(a: Vec2, b: Vec2, color: RGBA, width: number, dash?: readonly number[] | null): void;
  dot(p: Vec2, radius: number, color: RGBA): void;
  /** `maxWidth` in the same space as the current transform; text is clipped, never wrapped. */
  text(p: Vec2, value: string, color: RGBA, font: string, maxWidth: number): void;
  /** Width of `value` in `font`, in CSS px; memoized by the target. */
  measureText(value: string, font: string): number;
}
