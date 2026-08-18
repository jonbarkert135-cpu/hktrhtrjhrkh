/**
 * Public API of `@nexus/canvas-engine` (05_CANVAS_ENGINE.md §3).
 *
 * The engine is framework-free: it imports no React and touches no DOM global at module scope. A
 * host injects the render target, the clock and the resolved design tokens; the engine paints and
 * emits intents. See README.md for the wiring recipe and the documented deviations from
 * 20_ROADMAP.md P2 §4.
 */

export * from './types';
export * from './constants';

export {
  createEngine,
  DEFAULT_FEATURES,
  EMPTY_SCENE,
  type Engine,
  type EngineOptions,
  type EngineState,
} from './engine';
export { createScheduler, type Scheduler, type SchedulerOptions } from './scheduler';
export { createMinimap, type Minimap, type MinimapOptions } from './minimap';
export { createSelection, type SelectionListener } from './selection';

export {
  createCamera,
  CAMERA_EASE,
  type Camera,
  type CameraOptions,
  type ViewportSize,
} from './camera/camera';
export {
  inflateRect,
  rectsIntersect,
  resolveDpr,
  screenRectToWorld,
  screenToWorld,
  viewportWorldRect,
  worldRectToScreen,
  worldToScreen,
} from './camera/coords';
export {
  createPointerKindDetector,
  normalizeWheel,
  type NormalizedWheel,
  type PointerKind as WheelPointerKind,
  type WheelDefault,
  type WheelLike,
} from './camera/input-normalize';
export {
  createViewportStore,
  parseViewport,
  shouldRestore,
  type PersistedViewport,
  type RestoreDecision,
  type ViewportStorage,
  type ViewportStore,
} from './camera/persistence';

export {
  createSceneGraph,
  type SceneDirty,
  type SceneGraph,
  type SceneGraphOptions,
} from './scene/graph';
export {
  createGridIndex,
  rectContainsPoint,
  rectContainsRect,
  type GridIndexOptions,
  type IndexStats,
  type SpatialIndex,
} from './scene/index-grid';
export { cullRect, promotionCandidates, type PromotionPlan } from './scene/culling';

export { createCanvasTarget, type CanvasLike, type Context2DLike } from './render/target';
export {
  createLodController,
  paintLodFor,
  quantizeZoom,
  toLodLevel,
  type LodController,
  type PaintLod,
} from './render/lod';
export {
  paintFrame,
  straightEdgePath,
  type AlignmentGuide,
  type EdgePath,
  type FramePaintCounts,
  type RenderFrame,
  type RenderMetrics,
} from './render/layers';
export {
  createRoutedEdgePath,
  type RoutedEdgePath,
  type RoutedEdgePathOptions,
} from './render/routed-edge-path';
export {
  asOverlayDiff,
  createOverlay,
  type Overlay,
  type OverlayOptions,
  type OverlaySlot,
} from './render/overlay';
export { createTextCache, type TextCache } from './render/text';

export {
  cursorFor,
  type Cursor,
  type GestureNormalizer,
  type RawKey,
  type RawPointer,
  type RawWheel,
} from './interaction/gestures';
export { type FsmState, type FsmStateName, type Modifiers } from './interaction/fsm';
export { type GuideLine } from './interaction/snapping';
