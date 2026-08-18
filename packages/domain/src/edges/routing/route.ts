/**
 * The router (07_EDGE_SYSTEM.md §7). One entry point, `route(input)`, that resolves the mode and
 * the ports, produces drawing commands, clips them to the two cards and packages everything a
 * renderer, a hit-test or a label placer needs into an immutable {@link EdgeGeometry}.
 */

import type { EdgeCategory, RoutingMode } from '../types.ts';
import { clipToBoxes } from './clip.ts';
import { routeCurved } from './curved.ts';
import {
  FLATTEN_DRAFT_SEGMENTS,
  FLATTEN_MAX_SEGMENTS,
  add,
  centerOf,
  distance,
  flattenCommands,
  normalize,
  perpendicular,
  pointAtFraction,
  polylineBBox,
  polylineLength,
  scale,
  sub,
} from './geometry.ts';
import {
  buildObstacleGrid,
  firstClearRoute,
  inflateBoxes,
  roundCorners,
  routeOrthogonal,
  routingRegion,
  snapToLanes,
  zRoute,
} from './orthogonal.ts';
import { materializePort, portPoint, sideNormal } from './ports.ts';
import { catmullRomToBezier } from './curved.ts';
import { routeSelfLoop } from './selfloop.ts';
import { chooseSmartMode, degradesToStraight } from './smart.ts';
import { routeStraight } from './straight.ts';
import type {
  EdgeGeometry,
  GeometryKind,
  NodeBox,
  PathCommand,
  Point,
  Port,
  RouteInput,
} from './types.ts';
import { CLEARANCE } from './types.ts';

let revisionCounter = 0;

export interface RouteOptions {
  /** Relationship category, used only by the smart chooser (07 §7.8). */
  readonly category?: EdgeCategory | undefined;
  /** Previously chosen sides, for drag hysteresis (07 §7.1). */
  readonly previousSides?: { source?: Port['side']; target?: Port['side'] } | undefined;
}

export interface RouteResult extends EdgeGeometry {
  readonly srcPort: Port;
  readonly dstPort: Port;
}

export function route(input: RouteInput, options: RouteOptions = {}): RouteResult {
  revisionCounter += 1;
  const revision = revisionCounter;

  if (input.source.id === input.target.id) return selfLoopGeometry(input, revision);

  const resolvedMode = resolveMode(input, options);
  const orthogonal = resolvedMode === 'orthogonal';
  const srcPort = materializePort(input.source, input.target, input.srcPort, {
    orthogonal,
    previous: options.previousSides?.source,
  });
  const dstPort = materializePort(input.target, input.source, input.dstPort, {
    orthogonal,
    previous: options.previousSides?.target,
  });
  const p0 = portPoint(input.source, srcPort);
  const p1 = portPoint(input.target, dstPort);
  const n0 = sideNormal(srcPort.side);
  const n1 = sideNormal(dstPort.side);

  const built = buildCommands(input, resolvedMode, p0, p1, n0, n1);
  const kind: GeometryKind =
    resolvedMode === 'curved' ? 'bezier' : resolvedMode === 'orthogonal' ? 'poly' : 'line';
  return {
    ...finish(input, built.cmds, kind, resolvedMode, revision, built.degraded),
    srcPort,
    dstPort,
  };
}

/** Which mode actually runs, after the smart chooser and the short-edge degradation. */
export function resolveMode(input: RouteInput, options: RouteOptions = {}): RoutingMode {
  if (input.manualRoute) return input.mode === 'orthogonal' ? 'orthogonal' : 'curved';
  const span = distance(centerOf(input.source), centerOf(input.target));
  if (degradesToStraight(span, input.zoom)) return 'straight';
  if (input.mode !== 'smart') return input.mode;
  return chooseSmartMode({
    source: input.source,
    target: input.target,
    category: options.category,
    obstacles: input.obstacles,
  }).mode;
}

interface BuiltPath {
  readonly cmds: PathCommand[];
  readonly degraded: boolean;
}

function buildCommands(
  input: RouteInput,
  mode: RoutingMode,
  p0: Point,
  p1: Point,
  n0: Point,
  n1: Point,
): BuiltPath {
  if (input.manualRoute) {
    // A hand-routed edge keeps its shape; only the endpoints follow the cards (07 §8.3).
    return {
      cmds: catmullRomToBezier([p0, ...input.waypoints, p1], 0.5, n0, scale(n1, -1)),
      degraded: false,
    };
  }
  if (mode === 'orthogonal') return orthogonalCommands(input, p0, p1, n0, n1);
  if (mode === 'curved') {
    return {
      degraded: false,
      cmds: routeCurved({
        p0,
        p1,
        n0,
        n1,
        waypoints: waypointsWithAuto(input, p0, p1),
        curvature: input.curvature,
        siblingIndex: input.siblingIndex,
        siblingCount: input.siblingCount,
      }),
    };
  }
  return {
    degraded: false,
    cmds: routeStraight({
      p0,
      p1,
      waypoints: input.waypoints,
      siblingIndex: input.siblingIndex,
      siblingCount: input.siblingCount,
    }),
  };
}

/**
 * The smart "few obstacles" branch adds one waypoint pushed off the direct line (07 §7.8). It is
 * generated per route and never written to the document.
 */
function waypointsWithAuto(input: RouteInput, p0: Point, p1: Point): readonly Point[] {
  if (input.waypoints.length > 0 || input.mode !== 'smart') return input.waypoints;
  const decision = chooseSmartMode({
    source: input.source,
    target: input.target,
    obstacles: input.obstacles,
  });
  const push = decision.autoWaypointPush;
  if (push === null) return input.waypoints;
  const mid: Point = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  return [add(mid, scale(perpendicular(normalize(sub(p1, p0))), push))];
}

function orthogonalCommands(
  input: RouteInput,
  p0: Point,
  p1: Point,
  n0: Point,
  n1: Point,
): BuiltPath {
  // The search starts one clearance *outside* the card, so the first segment always leaves the
  // card cleanly instead of hugging its border (07 §7.7).
  const start = add(p0, scale(n0, CLEARANCE));
  const end = add(p1, scale(n1, CLEARANCE));
  const obstacles = input.obstacles;
  if (obstacles === undefined) {
    return {
      cmds: roundCorners([p0, ...zRoute(start, end), p1], input.cornerRadius),
      degraded: false,
    };
  }

  const region = routingRegion(start, end);
  const boxes = nearestObstacles(
    obstacles
      .query(region)
      .filter((box) => box.id !== input.source.id && box.id !== input.target.id),
    start,
    end,
  );
  // Probe the cheap L/Z shapes against the bare boxes first: when one is clear — the common case —
  // the Hanan lattice is never built at all.
  const inflated = inflateBoxes(boxes);
  const cheap = firstClearRoute(inflated, start, end);
  if (cheap !== null) {
    return {
      cmds: roundCorners([p0, ...cheap, p1], input.cornerRadius),
      degraded: false,
    };
  }
  const grid = buildObstacleGrid(region, boxes, start, end);
  const result = routeOrthogonal(grid, start, end);
  return {
    cmds: roundCorners([p0, ...snapToLanes(result.points), p1], input.cornerRadius),
    degraded: result.degraded,
  };
}

/**
 * Hard cap on how many cards a single route reasons about (07 §7.7 "bounded work per edge").
 * The Hanan lattice grows quadratically with the obstacle count, so an unbounded region on a
 * dense board would make one edge cost more than the whole frame budget. The nearest cards to
 * the corridor are the ones that actually shape the path.
 */
export const MAX_REGION_OBSTACLES = 16;

function nearestObstacles(boxes: readonly NodeBox[], p0: Point, p1: Point): readonly NodeBox[] {
  if (boxes.length <= MAX_REGION_OBSTACLES) return boxes;
  // Partial selection, not a sort: the region can hold hundreds of cards and only the closest
  // {@link MAX_REGION_OBSTACLES} of them matter, so each card is measured exactly once.
  const kept: NodeBox[] = [];
  const keptCost: number[] = [];
  for (const box of boxes) {
    const cost = corridorDistance(box, p0, p1);
    if (kept.length === MAX_REGION_OBSTACLES && cost >= (keptCost[kept.length - 1] as number)) {
      continue;
    }
    let at = kept.length;
    while (at > 0 && (keptCost[at - 1] as number) > cost) at -= 1;
    kept.splice(at, 0, box);
    keptCost.splice(at, 0, cost);
    if (kept.length > MAX_REGION_OBSTACLES) {
      kept.pop();
      keptCost.pop();
    }
  }
  return kept;
}

/** Squared distance from the card centre to the straight corridor `p0→p1`. */
function corridorDistance(box: NodeBox, p0: Point, p1: Point): number {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((cx - p0.x) * dx + (cy - p0.y) * dy) / lengthSq));
  const ex = p0.x + t * dx - cx;
  const ey = p0.y + t * dy - cy;
  return ex * ex + ey * ey;
}

function selfLoopGeometry(input: RouteInput, revision: number): RouteResult {
  const cmds = routeSelfLoop(input.source, input.siblingIndex);
  const geometry = finish(input, cmds, 'bezier', 'curved', revision, false);
  return {
    ...geometry,
    srcPort: { side: 'right', t: 0.35 },
    dstPort: { side: 'right', t: 0.65 },
  };
}

/** Flattening, clipping and the derived fields every mode shares. */
function finish(
  input: RouteInput,
  cmds: readonly PathCommand[],
  kind: GeometryKind,
  mode: RoutingMode,
  revision: number,
  degraded: boolean,
): EdgeGeometry {
  const maxSegments = input.quality === 'draft' ? FLATTEN_DRAFT_SEGMENTS : FLATTEN_MAX_SEGMENTS;
  const raw = flattenCommands(cmds, maxSegments);
  const selfLoop = input.source.id === input.target.id;
  const clipped = selfLoop
    ? { flat: raw, start: pointAtFraction(raw, 0), end: pointAtFraction(raw, 1) }
    : clipToBoxes(raw, input.source, input.target);
  const flat = Float32Array.from(clipped.flat);
  return {
    kind,
    mode,
    flat,
    cmds: [...cmds],
    bbox: polylineBBox(flat),
    length: polylineLength(flat),
    startPoint: clipped.start,
    endPoint: clipped.end,
    labelAnchor: pointAtFraction(flat, input.labelPosition),
    degraded,
    revision,
  };
}

/** Test seam: makes revision numbers reproducible across test files. */
export function resetRouteRevisions(): void {
  revisionCounter = 0;
}
