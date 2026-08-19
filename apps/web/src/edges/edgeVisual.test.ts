/** Relationship record → `EdgeView` (P5 §5.1, §5.2). */

import { builtinEdgeTypes, makeEdge, type BoardEdge } from '@nexus/domain';
import { describe, expect, it } from 'vitest';

import { edgeToView } from './edgeVisual.ts';

const T0 = '2026-06-01T00:00:00.000Z';
const base = (over: Partial<BoardEdge> = {}): BoardEdge => ({
  ...makeEdge({ id: 'e_1', from: 'a', to: 'b', type: 'references' }, T0),
  ...over,
});

describe('edgeToView', () => {
  it('takes routing, width and arrowheads from the type definition', () => {
    const view = edgeToView(base({ type: 'same_as' }));
    const definition = builtinEdgeTypes().get('same_as');
    expect(view.routing).toBe(definition.defaultRouting);
    // `same_as` is undirected with dot ends on both sides (07 §3.2).
    expect(view.style.arrowStart).toBe(true);
    expect(view.style.arrowEnd).toBe(true);
  });

  it('resolves the stroke token through the injected resolver', () => {
    const seen: string[] = [];
    const view = edgeToView(base({ type: 'same_as' }), {
      color: (token) => {
        seen.push(token);
        return { r: 1, g: 2, b: 3, a: 1 };
      },
    });
    expect(seen).toEqual([builtinEdgeTypes().get('same_as').strokeToken]);
    expect(view.style.color).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it('dashes weak claims and fades them by confidence', () => {
    const confident = edgeToView(base({ confidence: 'high' }));
    const weak = edgeToView(base({ confidence: 'low' }));
    expect(confident.style.dash).toBeNull();
    expect(weak.style.dash).not.toBeNull();
    expect(weak.style.opacity).toBeLessThan(confident.style.opacity);
  });

  it('honours the stored anchors and hides archived relationships', () => {
    const view = edgeToView(
      base({
        source: { nodeId: 'a', port: 'right', offset: 0.25, anchorKey: null },
        status: 'archived',
      }),
    );
    expect(view.fromAnchor).toEqual({ side: 'right', t: 0.25 });
    expect(view.toAnchor).toEqual({ side: 'auto', t: 0.5 });
    expect(view.hidden).toBe(true);
  });

  it('turns an empty label into null so the renderer skips the chip', () => {
    expect(edgeToView(base()).label).toBeNull();
    expect(edgeToView(base({ label: 'owns' })).label).toBe('owns');
  });
});
