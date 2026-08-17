/**
 * Culling ring math, velocity lead bias and DOM promotion budget (05_CANVAS_ENGINE.md §6.10,
 * roadmap P2 requirements 5 and 7).
 */

import { describe, expect, it } from 'vitest';
import { cullRect, promotionCandidates } from '../src/scene/culling';
import { createSceneGraph } from '../src/scene/graph';
import {
  CULL_MARGIN_MAX,
  CULL_MARGIN_MIN,
  CULL_MARGIN_RATIO,
  LOD_THRESHOLDS,
  MAX_DOM_NODES,
} from '../src/constants';
import type { LayerView, NodeView, Rect, SceneSnapshot } from '../src/types';

const LAYER: LayerView = { id: 'l1', name: 'Main', visible: true, locked: false };

function node(id: string, x: number, y: number, w = 100, h = 100): NodeView {
  return {
    id,
    kind: 'note',
    x,
    y,
    w,
    h,
    z: 0,
    layerId: LAYER.id,
    groupId: null,
    rotation: 0,
    locked: false,
    hidden: false,
    glyph: {
      accent: { r: 0, g: 0, b: 0, a: 1 },
      fill: { r: 0, g: 0, b: 0, a: 1 },
      icon: 'note',
      title: id,
      badgeCount: 0,
      thumbnailKey: null,
      status: 'none',
    },
    domKey: id,
    visualVersion: 1,
  };
}

const scene = (nodes: NodeView[]): SceneSnapshot => ({
  nodes,
  edges: [],
  groups: [],
  layers: [LAYER],
});

const VIEWPORT: Rect = { x: 0, y: 0, w: 1920, h: 1080 };

describe('cullRect margin ring', () => {
  it('inflates by max(CULL_MARGIN_MIN, ratio * width) when the camera is still', () => {
    const margin = CULL_MARGIN_RATIO * VIEWPORT.w; // 480 > CULL_MARGIN_MIN
    expect(cullRect(VIEWPORT, { x: 0, y: 0 })).toEqual({
      x: -margin,
      y: -margin,
      w: VIEWPORT.w + 2 * margin,
      h: VIEWPORT.h + 2 * margin,
    });
    expect(cullRect(VIEWPORT)).toEqual(cullRect(VIEWPORT, { x: 0, y: 0 }));
  });

  it('uses the floor for a narrow viewport and the cap for a huge one', () => {
    const narrow = cullRect({ x: 0, y: 0, w: 400, h: 300 }, { x: 0, y: 0 });
    expect(narrow.x).toBe(-CULL_MARGIN_MIN);

    const huge = cullRect({ x: 0, y: 0, w: 100_000, h: 50_000 }, { x: 0, y: 0 });
    expect(huge.x).toBe(-CULL_MARGIN_MAX);
  });

  it('biases the ring in the direction of travel and caps the lead', () => {
    const margin = CULL_MARGIN_RATIO * VIEWPORT.w;
    const right = cullRect(VIEWPORT, { x: 10, y: 0 });
    expect(right.x).toBe(-margin); // trailing edge keeps the plain margin
    expect(right.w).toBe(VIEWPORT.w + margin + (margin + 80)); // 10 px/frame ⇒ +80 lead

    const upLeft = cullRect(VIEWPORT, { x: -10, y: -10 });
    const lead = margin + Math.hypot(10, 10) * 8;
    expect(upLeft.x).toBeCloseTo(-lead, 6);
    expect(upLeft.y).toBeCloseTo(-lead, 6);
    expect(upLeft.w).toBeCloseTo(VIEWPORT.w + lead + margin, 6);

    const fling = cullRect(VIEWPORT, { x: 0, y: 5000 });
    expect(fling.h).toBe(VIEWPORT.h + margin + (margin + 1024)); // lead capped at 1024
  });

  it('treats non-finite velocity as zero', () => {
    expect(cullRect(VIEWPORT, { x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual(
      cullRect(VIEWPORT, { x: 0, y: 0 }),
    );
  });
});

describe('promotionCandidates', () => {
  it('promotes nothing below the DOM LOD threshold', () => {
    const g = createSceneGraph(scene([node('a', 0, 0)]));
    const cull = cullRect(VIEWPORT, { x: 0, y: 0 });
    expect(promotionCandidates(g.query, cull, LOD_THRESHOLDS.dom - 0.01)).toEqual({
      ids: [],
      budgetExceeded: false,
    });
    expect(promotionCandidates(g.query, cull, LOD_THRESHOLDS.dom).ids).toEqual(['a']);
  });

  it('only considers nodes inside the cull rect', () => {
    const g = createSceneGraph(scene([node('near', 100, 100), node('far', 50_000, 50_000)]));
    const plan = promotionCandidates(g.query, cullRect(VIEWPORT, { x: 0, y: 0 }), 1);
    expect(plan.ids).toEqual(['near']);
    expect(plan.budgetExceeded).toBe(false);
  });

  it('sorts by squared distance from the cull-rect centre', () => {
    const cull = cullRect(VIEWPORT, { x: 0, y: 0 });
    const cx = cull.x + cull.w / 2;
    const cy = cull.y + cull.h / 2;
    const g = createSceneGraph(
      scene([
        node('far', cx + 700 - 50, cy - 50),
        node('centre', cx - 50, cy - 50),
        node('mid', cx + 300 - 50, cy - 50),
      ]),
    );
    expect(promotionCandidates(g.query, cull, 1).ids).toEqual(['centre', 'mid', 'far']);
  });

  it('truncates at the budget nearest-first and flags the overflow', () => {
    const cull = cullRect(VIEWPORT, { x: 0, y: 0 });
    const cx = cull.x + cull.w / 2;
    const cy = cull.y + cull.h / 2;
    // 30 nodes stacked along a line from the centre outwards, 10 px apart.
    const nodes = Array.from({ length: 30 }, (_, i) =>
      node(`n${String(i).padStart(2, '0')}`, cx + i * 10, cy, 8, 8),
    );
    const g = createSceneGraph(scene(nodes));

    const plan = promotionCandidates(g.query, cull, 1, 5);
    expect(plan.ids).toEqual(['n00', 'n01', 'n02', 'n03', 'n04']);
    expect(plan.budgetExceeded).toBe(true);

    const all = promotionCandidates(g.query, cull, 1, 30);
    expect(all.ids).toHaveLength(30);
    expect(all.budgetExceeded).toBe(false);

    expect(promotionCandidates(g.query, cull, 1, 0)).toEqual({ ids: [], budgetExceeded: true });
  });

  it('defaults the budget to MAX_DOM_NODES', () => {
    const cull = cullRect(VIEWPORT, { x: 0, y: 0 });
    const nodes = Array.from({ length: MAX_DOM_NODES + 40 }, (_, i) =>
      node(
        `n${String(i).padStart(4, '0')}`,
        cull.x + (i % 40) * 20,
        cull.y + Math.floor(i / 40) * 20,
        8,
        8,
      ),
    );
    const g = createSceneGraph(scene(nodes));
    const plan = promotionCandidates(g.query, cull, 1);
    expect(plan.ids).toHaveLength(MAX_DOM_NODES);
    expect(plan.budgetExceeded).toBe(true);
    expect(new Set(plan.ids).size).toBe(MAX_DOM_NODES);
  });

  it('breaks distance ties deterministically by id', () => {
    const cull = cullRect(VIEWPORT, { x: 0, y: 0 });
    const cx = cull.x + cull.w / 2;
    const cy = cull.y + cull.h / 2;
    const g = createSceneGraph(
      scene([node('b', cx - 100 - 50, cy - 50), node('a', cx + 100 - 50, cy - 50)]),
    );
    expect(promotionCandidates(g.query, cull, 1).ids).toEqual(['a', 'b']);
  });

  it('never promotes hidden nodes', () => {
    const hidden = { ...node('h', 0, 0), hidden: true };
    const g = createSceneGraph(scene([node('v', 200, 200), hidden]));
    expect(promotionCandidates(g.query, cullRect(VIEWPORT, { x: 0, y: 0 }), 1).ids).toEqual(['v']);
  });
});
