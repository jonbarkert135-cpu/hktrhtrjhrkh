# @nexus/canvas-engine

The rendering and interaction core of the NEXUS canvas. It is **framework-free**: no React import,
no DOM global read at module scope, no `localStorage`, no network. A host injects everything that
touches the platform — the render target, the clock, the resolved design tokens, the DOM overlay —
and the engine paints frames and emits _intents_. The host applies intents to the document (P3 wires
them to Yjs), which is what keeps offline/CRDT editing possible later.

Specification: `NEXUS-SPEC/05_CANVAS_ENGINE.md`, phase brief `NEXUS-SPEC/20_ROADMAP.md` § "P2".

## Public API

```ts
import { createEngine, createCanvasTarget, createOverlay } from '@nexus/canvas-engine';

const engine = createEngine({
  target: createCanvasTarget(canvasElement), //   RenderTarget seam
  clock, //                                        EngineClock (rAF + timers)
  theme, //                                        EngineTheme  — resolved design tokens
  metrics, //                                      RenderMetrics — resolved sizes
  overlay: createOverlay({ document, container }), // optional DOM tier
  initialScene, //                                 SceneSnapshot
  prefersReducedMotion: false,
  capturePointer: (id) => canvasElement.setPointerCapture(id),
  releasePointer: (id) => canvasElement.releasePointerCapture(id),
});
```

| Member                                           | Purpose                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `setViewport(w, h, dpr?)`                        | Resizes the backing store and the camera viewport                      |
| `applyScenePatch(patch)`                         | One of the ten `ScenePatch` ops, applied in O(changed)                 |
| `invalidate()` / `tick(now?)`                    | Ask for a coalesced frame / paint one synchronously                    |
| `setPaused(paused)`                              | Tab visibility: stops scheduling, resumes without a jump               |
| `input`                                          | `pointerDown/Move/Up/Cancel`, `wheel`, `keyDown/Up`, `blur`            |
| `camera`, `selection`, `query`                   | Camera controller, ordered selection, read-only scene query            |
| `fitToNodes(ids, padding?)`, `zoomToSelection()` | Camera helpers used by the zoom cluster                                |
| `on(event, listener)`                            | `intent`, `selectionChanged`, `cameraChanged`, `hoverChanged`, `frame` |
| `state`                                          | Camera, FSM state name, cursor, hover, LOD tier, mounted hosts         |
| `dispose()`                                      | Cancels frames and timers, empties the overlay, drops listeners        |

The engine mutates nothing outside itself: a drag emits `move-nodes` intents (`start` → visual
previews → **one** `end` with all deltas), and the host decides what to persist.

## The `RenderTarget` seam

All painting goes through `RenderTarget` → `DrawContext` (a deliberately small verb set: `clear`,
`save/restore`, `setCamera`, `rect`, `roundRect`, `line`, `dot`, `text`, `measureText`). Two
implementations ship:

- `createCanvasTarget(canvas)` — a real 2D context, DPR-aware (backing store capped at `MAX_DPR`).
- `createRecordingTarget(w, h, dpr)` (from `@nexus/canvas-engine/testing`) — records every verb as
  a plain object and can print a stable text snapshot. This is why the whole engine, including the
  frame loop, runs in Node with **no jsdom and no browser** (`pnpm test:engine`).

## Testing harness

```ts
import {
  createManualClock,
  createRecordingTarget,
  runPointerScript,
} from '@nexus/canvas-engine/testing';
```

A manual clock (`advance`, `flushFrame`, `pendingFrames`, `pendingTimers`), pointer/wheel/key
builders, a scripted-gesture runner and `sceneSnapshot(target)`. Time never comes from `Date.now`
and frames never come from `requestAnimationFrame`, so every test is deterministic.

## LOD constants

`LOD_THRESHOLDS = { glyph: 0.18, glyphWithText: 0.4, dom: 0.55 }` with `LOD_HYSTERESIS = 0.02`,
`LOD_ZOOM_QUANTUM = 0.05` and `LOD_SETTLE_MS = 120`, plus `MAX_DOM_NODES = 260`. Below the `dom`
threshold nothing is promoted to the DOM: the canvas paints glyphs, then dots clustered into density
blobs. While a camera gesture is in flight the **tier is frozen** and the promotion set is computed
from the frozen zoom; both are released `LOD_SETTLE_MS` after the last camera event. That is what
keeps a 100-frame zoom across the 0.55 boundary from remounting every host (`test/thrash.test.ts`).

## Deviations from `20_ROADMAP.md` §4 (deliberate, reviewed)

| Roadmap                                     | Implemented                                       | Why                                                                                                |
| ------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `spatial/rbush-index.ts`, "R-tree"          | `scene/index-grid.ts`, uniform grid buckets       | `05_CANVAS_ENGINE.md` §6.2 freezes the grid and rejects an R-tree; no new dependency               |
| `class CanvasEngine({ container, … })` (05) | `createEngine({ target, clock, … })`              | Roadmap §5 req 1 asks for a factory and a `target`; a container would drag the DOM into the engine |
| Four physical canvases (05 §6.6)            | One canvas, fixed layer order inside `paintFrame` | Roadmap §7: one canvas in P2, split only if profiling demands it                                   |
| `reduce(state, event)`                      | `reduce(state, event, ctx)`                       | 05 §7.1: the FSM needs a read-only view of scene, selection and zoom; still pure                   |
| Marquee "contain" = Ctrl (05 §7.11)         | Alt = contain, Shift = add                        | Roadmap req 11; Alt cannot mean both contain and subtract for the same gesture                     |
| Snap candidates "24 nearest" (roadmap)      | `SNAP_CANDIDATE_LIMIT = 400`                      | 05 §7.8 and `constants.ts`; screen-space tolerance already bounds the work                         |

## Layout

```text
src/
  types.ts, constants.ts        frozen public vocabulary and tuning values
  camera/                       transforms, zoom curve, wheel normalization, animation, persistence
  scene/                        grid spatial index, scene graph + patches, culling and promotion
  render/                       canvas target, recording target, LOD, layers, text cache, DOM overlay
  interaction/                  FSM reducer, gesture normalizer, snapping and guides
  engine.ts, scheduler.ts       the facade and the coalescing frame scheduler
  minimap.ts                    independent 10 fps minimap with click-to-jump and drag-to-pan
  selection.ts, index.ts, testing/
```
