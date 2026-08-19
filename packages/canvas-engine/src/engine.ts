/**
 * The engine facade: the one object a host talks to (20_ROADMAP P2 §5 req 1, 05_CANVAS_ENGINE.md §4).
 *
 * It owns no document state. It reads a `SceneSnapshot`, paints it, turns raw input into intents and
 * hands those intents to the host, which is the only place a document is mutated (§7). No React, no
 * DOM globals at module scope: the browser bits (canvas, overlay slots, clock) are all injected, so
 * the whole loop runs in Node against the recording target.
 */

import { createCamera, type Camera } from './camera/camera';
import {
  EDGE_HIT_TOL_PX,
  HANDLE_HIT_PAD_PX,
  MAX_DOM_NODES,
  PORT_BAND_PX,
  PORT_MIN_ZOOM,
  WAYPOINT_HIT_PX,
} from './constants';
import { facingPort, portAt, portPoint } from './edges/ports';
import type { EdgePicker } from './edges/pick';
import {
  createGestures,
  cursorFor,
  type Cursor,
  type GestureNormalizer,
} from './interaction/gestures';
import {
  initialState,
  reduce,
  type Effect,
  type FsmContext,
  type FsmEvent,
  type FsmState,
  type FsmStateName,
} from './interaction/fsm';
import type { GuideLine } from './interaction/snapping';
import {
  paintFrame,
  straightEdgePath,
  type AlignmentGuide,
  type EdgePath,
  type RenderFrame,
  type RenderMetrics,
} from './render/layers';
import { createLodController, toLodLevel, type LodController } from './render/lod';
import type { Overlay, OverlaySlot } from './render/overlay';
import { createTextCache, type TextCache } from './render/text';
import { cullRect, promotionCandidates } from './scene/culling';
import { createSceneGraph, type SceneGraph } from './scene/graph';
import { rectContainsPoint } from './scene/index-grid';
import { createScheduler, type Scheduler } from './scheduler';
import { createSelection } from './selection';
import type {
  CameraCause,
  CameraState,
  ConnectionPreview,
  EdgeId,
  EngineClock,
  EngineEvents,
  EngineFeatures,
  EdgeView,
  EngineTheme,
  EntityId,
  FrameStats,
  HitTarget,
  NodeId,
  NodeView,
  Rect,
  RenderTarget,
  ScenePatch,
  SceneQuery,
  SceneSnapshot,
  SelectionController,
  Unsubscribe,
  Vec2,
} from './types';

/* -------------------------------------------------------------------- options */

export const EMPTY_SCENE: SceneSnapshot = {
  nodes: [],
  edges: [],
  groups: [],
  layers: [{ id: 'default', name: 'default', visible: true, locked: false }],
};

export const DEFAULT_FEATURES: EngineFeatures = {
  grid: true,
  snapToGrid: false,
  alignmentGuides: true,
  minimap: true,
  inertialPan: true,
  debugOverlay: false,
};

export interface EngineOptions {
  /** Where frames are painted; `createCanvasTarget` in a browser, `createRecordingTarget` in tests. */
  target: RenderTarget;
  clock: EngineClock;
  theme: EngineTheme;
  /** Sizes resolved from design tokens by the host; the engine hardcodes no design value. */
  metrics: RenderMetrics;
  initialScene?: SceneSnapshot;
  /** DOM node hosts. Omitted in headless tests: the canvas then paints glyphs at every zoom. */
  overlay?: Overlay<OverlaySlot>;
  features?: Partial<EngineFeatures>;
  prefersReducedMotion?: boolean;
  /** Pointer capture is a DOM concern; the host wires these to `setPointerCapture`. */
  capturePointer?: (pointerId: number) => void;
  releasePointer?: (pointerId: number) => void;
  edgePath?: EdgePath;
  /**
   * Edge hit-testing. Injected because it needs the routed geometry and therefore the domain
   * package; without it edges are simply not selectable (the P2 behaviour).
   */
  edgeHit?: EdgePicker;
  /** DOM promotion budget; lowered in tests that assert the budget path. */
  domBudget?: number;
}

export interface EngineState {
  camera: Readonly<CameraState>;
  interaction: FsmStateName;
  cursor: Cursor;
  hover: HitTarget;
  lod: RenderFrame['lod'];
  mountedHosts: number;
  /** True while the LOD zoom is quantized because the camera is moving (req 7). */
  quantized: boolean;
  /** The in-flight connection, or null when no edge is being drawn (P5 §6). */
  connection: ConnectionPreview | null;
}

export interface Engine {
  readonly camera: Camera;
  readonly selection: SelectionController;
  readonly query: SceneQuery;
  readonly state: EngineState;
  /** Raw input entry points; the engine normalizes gestures itself (05 §7.3). */
  readonly input: GestureNormalizer;
  setViewport(width: number, height: number, dpr?: number): void;
  applyScenePatch(patch: ScenePatch): void;
  setTheme(theme: EngineTheme, metrics?: RenderMetrics): void;
  setFeatures(features: Partial<EngineFeatures>): void;
  /** Tab visibility: paused engines schedule nothing and resume without a time jump (§8). */
  setPaused(paused: boolean): void;
  /** Asks for one coalesced frame. */
  invalidate(): void;
  /** Paints one frame synchronously; the test and bench entry point. */
  tick(now?: number): FrameStats;
  fitToNodes(ids: readonly NodeId[], padding?: number): void;
  zoomToSelection(): void;
  on<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): Unsubscribe;
  dispose(): void;
}

/* --------------------------------------------------------------------- frame */

/** The mutable twin of `RenderFrame`: one instance is reused for every frame (req 15). */
interface FrameBuffer {
  camera: CameraState;
  viewport: { width: number; height: number };
  theme: EngineTheme;
  metrics: RenderMetrics;
  lod: RenderFrame['lod'];
  showGrid: boolean;
  nodes: NodeView[];
  edges: readonly EdgeView[];
  node: (id: NodeId) => NodeView | undefined;
  selected: NodeView[];
  guides: AlignmentGuide[];
  marquee: Rect | null;
  text: TextCache;
  edgePath: EdgePath;
  selectedEdges: Set<EdgeId>;
  connection: ConnectionPreview | null;
  timeMs: number;
  reducedMotion: boolean;
}

const guideOf = (g: GuideLine): AlignmentGuide => ({
  axis: g.axis,
  position: g.pos,
  from: g.from,
  to: g.to,
});

/* -------------------------------------------------------------------- engine */

export function createEngine(options: EngineOptions): Engine {
  const { target, clock, overlay } = options;
  let theme = options.theme;
  let metrics = options.metrics;
  let features: EngineFeatures = { ...DEFAULT_FEATURES, ...options.features };
  const domBudget = options.domBudget ?? MAX_DOM_NODES;
  const edgePath = options.edgePath ?? straightEdgePath;

  const graph: SceneGraph = createSceneGraph(options.initialScene ?? EMPTY_SCENE);
  const listeners: { [K in keyof EngineEvents]: Set<EngineEvents[K]> } = {
    intent: new Set(),
    selectionChanged: new Set(),
    cameraChanged: new Set(),
    hoverChanged: new Set(),
    hostsChanged: new Set(),
    frame: new Set(),
  };

  /** Last promoted set, compared as a list because promotion order is stable and meaningful. */
  let hostIds: NodeId[] = [];

  const selection = createSelection(graph.query, (ids: readonly EntityId[]) => {
    for (const l of listeners.selectionChanged) l(ids);
    invalidate();
  });

  const lod: LodController = createLodController(clock);

  const camera: Camera = createCamera({
    viewport: { width: target.size.width, height: target.size.height },
    clock,
    prefersReducedMotion: options.prefersReducedMotion ?? false,
    sceneBounds: () => (graph.query.nodeCount === 0 ? null : graph.query.sceneBounds),
    entityBounds: (id: EntityId) => {
      const n = graph.query.node(id);
      return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
    },
    onChange: (state: Readonly<CameraState>, cause: CameraCause) => {
      lod.cameraChanged();
      for (const l of listeners.cameraChanged) l(state, cause);
      emitIntent({ t: 'camera', camera: { ...state }, cause });
      invalidate();
    },
  });

  /* ---------------------------------------------------------- frame state */

  const text = createTextCache();
  const frame: FrameBuffer = {
    camera: camera.state,
    viewport: { width: target.size.width, height: target.size.height },
    theme,
    metrics,
    lod: 'glyph',
    showGrid: features.grid,
    nodes: [],
    edges: [],
    node: (id: NodeId) => previewed(graph.query.node(id)),
    selected: [],
    guides: [],
    marquee: null,
    text,
    edgePath,
    selectedEdges: new Set<EdgeId>(),
    connection: null,
    timeMs: 0,
    reducedMotion: options.prefersReducedMotion ?? false,
  };
  const visible = new Set<NodeId>();
  const edgeBuf: EdgeView[] = [];
  const promoted: NodeView[] = [];
  /** Reused copies of dragged nodes: a preview never mutates the scene (req 13). */
  const previewCache = new Map<NodeId, NodeView>();
  let previewIds: readonly NodeId[] = [];
  let previewDx = 0;
  let previewDy = 0;
  let mountedHosts = 0;
  /** Tier of the previous frame and the tier frozen for the duration of a camera gesture. */
  let lastLevel: RenderFrame['lod'] | null = null;
  let held: RenderFrame['lod'] | null = null;
  /** Zoom frozen for the gesture, so DOM promotion does not follow a wobbling zoom. */
  let heldZoom: number | null = null;
  const promotionRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  const previewed = (n: NodeView | undefined): NodeView | undefined => {
    if (n === undefined || previewIds.length === 0 || !previewSet.has(n.id)) return n;
    let copy = previewCache.get(n.id);
    if (copy === undefined || copy.id !== n.id) {
      copy = { ...n };
      previewCache.set(n.id, copy);
    }
    Object.assign(copy, n);
    copy.x = n.x + previewDx;
    copy.y = n.y + previewDy;
    return copy;
  };
  const previewSet = new Set<NodeId>();

  /* -------------------------------------------------------------- painting */

  function paint(now: number): FrameStats {
    const t0 = clock.now();
    if (camera.isAnimating) camera.tickAnimation(now);

    const cam = camera.state;
    // 05 §6.8: while a camera gesture is in flight the tier is *frozen* at the value it had when the
    // gesture started, and the quantized zoom (req 7) only refines the glyph details inside it.
    // Without the freeze a wobbling zoom across 0.55 unmounts and remounts every host per frame.
    const level = lod.levelFor(cam.zoom);
    if (!lod.quantized) {
      held = null;
      heldZoom = null;
    } else {
      held ??= lastLevel ?? level;
      heldZoom ??= cam.zoom;
    }
    const settled = held ?? level;
    // Without an overlay (headless tests, bench, minimap hosts) the DOM tier has nobody to paint
    // it, so the canvas keeps drawing glyphs instead of an empty frame.
    const paintLod = overlay === undefined && settled === 'dom' ? 'glyphText' : settled;
    lastLevel = level;
    const cull = cullRect(camera.viewportWorld);

    frame.camera = cam;
    frame.viewport.width = target.size.width;
    frame.viewport.height = target.size.height;
    frame.theme = theme;
    frame.metrics = metrics;
    frame.lod = paintLod;
    frame.showGrid = features.grid;
    frame.timeMs = now;

    // Bottom→top: layer rank, then the graph's per-layer z order.
    frame.nodes.length = 0;
    visible.clear();
    for (const layer of graph.layers) {
      if (!layer.visible) continue;
      const ids = graph.byLayer.get(layer.id);
      if (ids === undefined) continue;
      for (const id of ids) {
        const node = previewed(graph.nodes.get(id));
        if (node === undefined || node.hidden) continue;
        if (!rectsOverlap(node, cull)) continue;
        frame.nodes.push(node);
        visible.add(node.id);
      }
    }

    edgeBuf.length = 0;
    for (const edge of graph.edges.values()) {
      if (visible.has(edge.from) || visible.has(edge.to)) edgeBuf.push(edge);
    }
    frame.edges = edgeBuf;

    frame.selected.length = 0;
    frame.selectedEdges.clear();
    for (const id of selection.ids) {
      const node = previewed(graph.nodes.get(id));
      if (node !== undefined && !node.hidden) frame.selected.push(node);
      else if (graph.edges.has(id)) frame.selectedEdges.add(id);
    }

    const ctx = target.beginFrame();
    const counts = paintFrame(ctx, frame);
    target.endFrame();

    if (overlay !== undefined) {
      promoted.length = 0;
      if (settled === 'dom') {
        // Promotion follows the frozen zoom: the mounted set must not churn while the user zooms.
        const zoom = heldZoom ?? cam.zoom;
        promotionRect.x = cam.x;
        promotionRect.y = cam.y;
        promotionRect.w = target.size.width / zoom;
        promotionRect.h = target.size.height / zoom;
        // The tier is already decided above; the frozen zoom keeps the gate consistent with it.
        const plan = promotionCandidates(graph.query, cullRect(promotionRect), zoom, domBudget);
        for (const id of plan.ids) {
          const node = previewed(graph.nodes.get(id));
          if (node !== undefined && !node.hidden) promoted.push(node);
        }
      }
      overlay.setTransform({ x: cam.x, y: cam.y, scale: cam.zoom });
      overlay.sync(promoted);
      mountedHosts = promoted.length;
      if (hostSetChanged(promoted)) {
        hostIds = promoted.map((node) => node.id);
        for (const l of listeners.hostsChanged) l(hostIds);
      }
    }

    graph.clearDirty();
    // A moving dash is the only thing in the engine that needs a frame nobody asked for.
    if (counts.animatedEdges > 0) invalidate();
    const stats: FrameStats = {
      duration: clock.now() - t0,
      paintedNodes: counts.nodes,
      paintedEdges: counts.edges,
      mountedHosts,
      lod: toLodLevel(paintLod),
    };
    for (const l of listeners.frame) l(stats);
    return stats;
  }

  const scheduler: Scheduler = createScheduler({ clock, onFrame: paint });

  function invalidate(): void {
    scheduler.request();
  }

  /* ----------------------------------------------------------- interaction */

  let fsm: FsmState = initialState;
  let hover: HitTarget = { t: 'canvas' };
  let cursor: Cursor = cursorFor(fsm, hover);

  /** Allocation-free comparison against the previous promoted set (requirement 15). */
  function hostSetChanged(next: readonly NodeView[]): boolean {
    if (next.length !== hostIds.length) return true;
    for (let i = 0; i < next.length; i += 1) if (next[i]?.id !== hostIds[i]) return true;
    return false;
  }

  function emitIntent(intent: Parameters<EngineEvents['intent']>[0]): void {
    for (const l of listeners.intent) l(intent);
  }

  /**
   * Priority (P5 §5.3, §5.10): resize handle → connection port → node → edge → canvas. The port
   * band straddles the card border, so it is tested both for the node under the pointer and for
   * the nodes just outside it.
   */
  function hitTest(world: Vec2): HitTarget {
    const zoom = camera.state.zoom;
    // Waypoints of the selected edges win over everything but the resize handle: they are small,
    // deliberate affordances and are only shown while their edge is selected (07 §8.3).
    const waypoint = waypointAt(world, zoom);
    if (waypoint !== null) return waypoint;
    const box = selection.bounds();
    if (box !== null && selection.ids.length === 1) {
      const id = selection.ids[0];
      const handle = handleAt(box, world, zoom);
      if (handle !== null && typeof id === 'string') return { t: 'handle', id, handle };
    }

    const ports = zoom >= PORT_MIN_ZOOM;
    const node = graph.query.nodeAt(world);
    if (node !== null) {
      const anchor = ports ? portAt(node, world, zoom) : null;
      return anchor === null ? { t: 'node', id: node.id } : { t: 'port', id: node.id, anchor };
    }

    const band = ports ? PORT_BAND_PX / Math.max(zoom, 1e-3) : 0;
    bandRect.x = world.x - band;
    bandRect.y = world.y - band;
    bandRect.w = band * 2;
    bandRect.h = band * 2;
    const near = band === 0 ? [] : graph.query.nodesIn(bandRect);
    for (let i = near.length - 1; i >= 0; i -= 1) {
      const candidate = near[i];
      if (candidate === undefined) continue;
      const anchor = portAt(candidate, world, zoom);
      if (anchor !== null) return { t: 'port', id: candidate.id, anchor };
    }

    const edge = options.edgeHit?.(world, EDGE_HIT_TOL_PX / Math.max(zoom, 1e-3), edgeBuf);
    if (edge !== undefined && edge !== null) return { t: 'edge', id: edge };
    return { t: 'canvas' };
  }

  const bandRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  /** Nearest waypoint of a selected edge within the grab radius, or null. */
  function waypointAt(world: Vec2, zoom: number): HitTarget | null {
    const tolerance = WAYPOINT_HIT_PX / Math.max(zoom, 1e-3);
    let best: HitTarget | null = null;
    let bestD2 = tolerance * tolerance;
    for (const id of selection.ids) {
      const edge = graph.edges.get(id);
      if (edge === undefined || edge.hidden) continue;
      const points = edge.waypoints ?? [];
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i] as Vec2;
        const d2 = (p.x - world.x) ** 2 + (p.y - world.y) ** 2;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = { t: 'waypoint', id, index: i };
        }
      }
    }
    return best;
  }

  /** Mirrors the FSM's `connecting` state into the frame so the renderer can paint the preview. */
  function syncConnection(): void {
    if (fsm.name !== 'connecting') {
      frame.connection = null;
      return;
    }
    const source = graph.query.node(fsm.from);
    if (source === undefined) {
      frame.connection = null;
      return;
    }
    const anchor =
      fsm.fromAnchor.side === 'auto' ? facingPort(source, fsm.current) : fsm.fromAnchor;
    const target = graph.query.nodeAt(fsm.current);
    frame.connection = {
      from: fsm.from,
      fromAnchor: fsm.fromAnchor,
      fromPoint: portPoint(source, anchor),
      to: fsm.current,
      targetId: target === null ? null : target.id,
      valid: target === null || target.id !== fsm.from,
      keyboard: fsm.via === 'keyboard',
    };
  }

  const context = (): FsmContext => ({
    scene: graph.query,
    selection: selection.ids,
    zoom: camera.state.zoom,
    viewportWorld: camera.viewportWorld,
    features: { snapToGrid: features.snapToGrid, alignmentGuides: features.alignmentGuides },
  });

  function clearPreview(): void {
    previewIds = [];
    previewSet.clear();
    previewDx = 0;
    previewDy = 0;
  }

  function applyEffect(effect: Effect): void {
    switch (effect.t) {
      case 'intent':
        if (effect.intent.t === 'select') selection.set(effect.intent.ids, effect.intent.mode);
        emitIntent(effect.intent);
        return;
      case 'capture':
        options.capturePointer?.(effect.pointerId);
        return;
      case 'release':
        options.releasePointer?.(effect.pointerId);
        return;
      case 'marquee':
        frame.marquee = effect.rect;
        return;
      case 'guides':
        frame.guides.length = 0;
        for (const g of effect.guides) frame.guides.push(guideOf(g));
        return;
      case 'preview-move':
        previewIds = effect.ids;
        previewSet.clear();
        for (const id of effect.ids) previewSet.add(id);
        previewDx = effect.dx;
        previewDy = effect.dy;
        return;
      case 'restore-geometry':
        // Nothing was committed while dragging, so dropping the preview *is* the restore.
        clearPreview();
        return;
      case 'camera-pan':
        camera.panBy(effect.dxScreen, effect.dyScreen);
        return;
      case 'camera-zoom':
        camera.zoomBy(effect.steps, effect.anchorScreen);
        return;
      case 'camera-zoom-factor':
        camera.zoomTo(camera.state.zoom * effect.factor, effect.anchorScreen);
        return;
      case 'camera-command':
        applyCameraCommand(effect.cmd);
        return;
      case 'focus-editor':
        // The editor lives in the DOM overlay; the host reacts to the `begin-edit-text` intent.
        return;
      default:
        return;
    }
  }

  function applyCameraCommand(
    cmd: 'fit-all' | 'fit-selection' | 'zoom-100' | 'zoom-in' | 'zoom-out',
  ): void {
    const centre: Vec2 = { x: target.size.width / 2, y: target.size.height / 2 };
    switch (cmd) {
      case 'fit-all':
        camera.fitAll();
        return;
      case 'fit-selection':
        zoomToSelection();
        return;
      case 'zoom-100':
        camera.zoomTo(1, centre);
        return;
      case 'zoom-in':
        camera.zoomBy(1, centre);
        return;
      case 'zoom-out':
        camera.zoomBy(-1, centre);
        return;
      default:
        return;
    }
  }

  function dispatch(event: FsmEvent): void {
    const before = fsm.name;
    const { state, effects } = reduce(fsm, event, context());
    fsm = state;
    for (const effect of effects) applyEffect(effect);

    if (fsm.name !== 'draggingNodes' && previewIds.length > 0) clearPreview();
    if (fsm.name !== 'marquee' && frame.marquee !== null) frame.marquee = null;
    if (fsm.name !== 'draggingNodes' && frame.guides.length > 0) frame.guides.length = 0;
    syncConnection();
    overlay?.setDragging(fsm.name === 'draggingNodes');

    if (event.t === 'pointermove' || event.t === 'pointerdown') {
      const next = event.target;
      if (!sameTarget(hover, next)) {
        hover = next;
        for (const l of listeners.hoverChanged) l(hover);
      }
    }
    cursor = cursorFor(fsm, hover);
    if (before !== fsm.name || effects.length > 0) invalidate();
  }

  const input: GestureNormalizer = createGestures({
    clock,
    screenToWorld: (p: Vec2) => camera.screenToWorld(p),
    hitTest,
    emit: dispatch,
  });

  function zoomToSelection(): void {
    const box = selection.bounds();
    if (box === null) camera.fitAll();
    else camera.fit(box);
  }

  /* ---------------------------------------------------------------- public */

  let disposed = false;

  return {
    camera,
    selection,
    query: graph.query,
    input,
    get state(): EngineState {
      return {
        camera: camera.state,
        interaction: fsm.name,
        cursor,
        hover,
        lod: frame.lod,
        mountedHosts,
        quantized: lod.quantized,
        connection: frame.connection,
      };
    },
    setViewport(width: number, height: number, dpr = target.dpr): void {
      target.resize(width, height, dpr);
      camera.setViewportSize(target.size.width, target.size.height);
      invalidate();
    },
    applyScenePatch(patch: ScenePatch): void {
      graph.applyPatch(patch);
      invalidate();
    },
    setTheme(next: EngineTheme, nextMetrics?: RenderMetrics): void {
      theme = next;
      if (nextMetrics !== undefined) metrics = nextMetrics;
      invalidate();
    },
    setFeatures(next: Partial<EngineFeatures>): void {
      features = { ...features, ...next };
      invalidate();
    },
    setPaused(paused: boolean): void {
      scheduler.setPaused(paused);
    },
    invalidate,
    tick(now: number = clock.now()): FrameStats {
      return paint(now);
    },
    fitToNodes(ids: readonly NodeId[], padding?: number): void {
      const box = unionOf(ids, graph.query);
      if (box === null) return;
      camera.fit(box, padding === undefined ? undefined : { padding });
    },
    zoomToSelection,
    on<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): Unsubscribe {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scheduler.dispose();
      input.dispose();
      lod.dispose();
      camera.cancelAnimation();
      overlay?.dispose();
      target.dispose();
      previewCache.clear();
      clearPreview();
      for (const key of Object.keys(listeners)) {
        listeners[key as keyof EngineEvents].clear();
      }
      mountedHosts = 0;
    },
  };
}

/* ------------------------------------------------------------------ helpers */

function rectsOverlap(n: NodeView, r: Rect): boolean {
  return n.x <= r.x + r.w && n.x + n.w >= r.x && n.y <= r.y + r.h && n.y + n.h >= r.y;
}

function sameTarget(a: HitTarget, b: HitTarget): boolean {
  if (a.t !== b.t) return false;
  if (a.t === 'canvas' || b.t === 'canvas') return true;
  return 'id' in a && 'id' in b && a.id === b.id;
}

function unionOf(ids: readonly NodeId[], query: SceneQuery): Rect | null {
  let box: Rect | null = null;
  for (const id of ids) {
    const n = query.node(id);
    if (n === undefined) continue;
    if (box === null) {
      box = { x: n.x, y: n.y, w: n.w, h: n.h };
      continue;
    }
    const right = Math.max(box.x + box.w, n.x + n.w);
    const bottom = Math.max(box.y + box.h, n.y + n.h);
    box.x = Math.min(box.x, n.x);
    box.y = Math.min(box.y, n.y);
    box.w = right - box.x;
    box.h = bottom - box.y;
  }
  return box;
}

const HANDLE_ORDER = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

/** Handles are screen-sized, so their world reach grows as the user zooms out (05 §7.7). */
function handleAt(box: Rect, world: Vec2, zoom: number): (typeof HANDLE_ORDER)[number] | null {
  const pad = HANDLE_HIT_PAD_PX / zoom;
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  const spots: Array<[number, number]> = [
    [xs[0] ?? 0, ys[0] ?? 0],
    [xs[1] ?? 0, ys[0] ?? 0],
    [xs[2] ?? 0, ys[0] ?? 0],
    [xs[2] ?? 0, ys[1] ?? 0],
    [xs[2] ?? 0, ys[2] ?? 0],
    [xs[1] ?? 0, ys[2] ?? 0],
    [xs[0] ?? 0, ys[2] ?? 0],
    [xs[0] ?? 0, ys[1] ?? 0],
  ];
  for (let i = 0; i < spots.length; i += 1) {
    const spot = spots[i];
    const handle = HANDLE_ORDER[i];
    if (spot === undefined || handle === undefined) continue;
    const hit: Rect = { x: spot[0] - pad, y: spot[1] - pad, w: pad * 2, h: pad * 2 };
    if (rectContainsPoint(hit, world)) return handle;
  }
  return null;
}
