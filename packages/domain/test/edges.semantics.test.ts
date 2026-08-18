import { describe, expect, it } from 'vitest';

import { makeEdge } from '../src/entities/edge.ts';
import {
  EdgeTypeRegistry,
  FALLBACK_EDGE_TYPE,
  SUGGEST_WEIGHTS,
  bestEdgeType,
  edgeIdentityKey,
  isPairAllowed,
  matchSpecificity,
  nodePairKey,
  normalizeUndirected,
  readingLabel,
  registerEdgeBuiltins,
  suggestEdgeTypes,
} from '../src/edges/index.ts';

const NOW = '2026-08-18T00:00:00.000Z';
const registry: EdgeTypeRegistry = registerEdgeBuiltins(new EdgeTypeRegistry());

describe('endpoint rules', () => {
  it('matches the pairs a relationship expects', () => {
    expect(isPairAllowed(registry.get('works_at'), 'person', 'organization')).toBe(true);
    expect(isPairAllowed(registry.get('works_at'), 'organization', 'person')).toBe(false);
  });

  it('treats the wildcard as any node type', () => {
    expect(isPairAllowed(registry.get('references'), 'image', 'timeline-event')).toBe(true);
  });

  it('scores a narrow rule as more specific than a broad one', () => {
    const exact = matchSpecificity(registry.get('works_at'), 'person', 'organization');
    const broad = matchSpecificity(registry.get('alias_of'), 'person', 'organization');
    const wildcard = matchSpecificity(registry.get('references'), 'person', 'organization');
    expect(exact).toBe(1);
    expect(exact).toBeGreaterThan(broad);
    expect(broad).toBeGreaterThan(wildcard);
    expect(matchSpecificity(registry.get('works_at'), 'organization', 'person')).toBe(0);
  });
});

describe('reading direction', () => {
  it('reads forwards and backwards', () => {
    const def = registry.get('works_at');
    expect(readingLabel(def)).toBe('works at');
    expect(readingLabel(def, true)).toBe('employs');
  });
});

describe('undirected normalisation', () => {
  it('orders the endpoints lexicographically and mirrors the waypoints', () => {
    const edge = {
      ...makeEdge({ id: 'e1', from: 'zeta', to: 'alpha', type: 'knows' }, NOW),
      directed: false,
      waypoints: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    };
    const normalized = normalizeUndirected(edge);
    expect(normalized.source.nodeId).toBe('alpha');
    expect(normalized.target.nodeId).toBe('zeta');
    expect(normalized.waypoints).toEqual([
      { x: 2, y: 2 },
      { x: 1, y: 1 },
    ]);
  });

  it('leaves directed edges and already-ordered pairs untouched', () => {
    const directed = makeEdge({ id: 'e2', from: 'zeta', to: 'alpha' }, NOW);
    expect(normalizeUndirected(directed)).toBe(directed);
    const ordered = { ...makeEdge({ id: 'e3', from: 'alpha', to: 'zeta' }, NOW), directed: false };
    expect(normalizeUndirected(ordered)).toBe(ordered);
  });

  it('gives mirrored undirected twins the same identity key', () => {
    const a = {
      ...makeEdge({ id: 'a', from: 'n1', to: 'n2', type: 'knows' }, NOW),
      directed: false,
    };
    const b = {
      ...makeEdge({ id: 'b', from: 'n2', to: 'n1', type: 'knows' }, NOW),
      directed: false,
    };
    expect(edgeIdentityKey(a)).toBe(edgeIdentityKey(b));
  });

  it('keeps directed opposites distinct but pairs them for separation', () => {
    const a = makeEdge({ id: 'a', from: 'n1', to: 'n2' }, NOW);
    const b = makeEdge({ id: 'b', from: 'n2', to: 'n1' }, NOW);
    expect(edgeIdentityKey(a)).not.toBe(edgeIdentityKey(b));
    expect(nodePairKey(a)).toBe(nodePairKey(b));
  });
});

describe('type suggestion', () => {
  it('ranks an allowed relationship above an unrelated one', () => {
    const ranked = suggestEdgeTypes(registry, 'person', 'organization');
    const top = ranked[0];
    expect(top).toBeDefined();
    expect(['works_at', 'member_of']).toContain(top?.type);
    expect(top?.score).toBeGreaterThanOrEqual(SUGGEST_WEIGHTS.allowed);
    const resolves = ranked.find((entry) => entry.type === 'resolves_to');
    expect(resolves?.score).toBe(0);
  });

  it('lets project history and the last category break a tie', () => {
    const withHistory = suggestEdgeTypes(registry, 'person', 'organization', {
      projectHistogram: { member_of: 10, works_at: 1 },
      lastUsedCategory: 'social',
    });
    expect(withHistory[0]?.type).toBe('member_of');
  });

  it('is deterministic: equal scores break on the type id', () => {
    const first = suggestEdgeTypes(registry, 'ip', 'ip').map((entry) => entry.type);
    const second = suggestEdgeTypes(registry, 'ip', 'ip').map((entry) => entry.type);
    expect(first).toEqual(second);
    const zeroScored = suggestEdgeTypes(registry, 'ip', 'ip').filter((entry) => entry.score === 0);
    const ids = zeroScored.map((entry) => entry.type);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('applies the per-type heuristic and ignores a non-finite one', () => {
    const local = registerEdgeBuiltins(new EdgeTypeRegistry());
    local.override({
      ...local.get('depends_on'),
      suggest: () => 1,
    });
    local.override({
      ...local.get('forked_from'),
      suggest: () => Number.NaN,
    });
    const ranked = suggestEdgeTypes(local, 'repo', 'repo');
    const dependsOn = ranked.find((entry) => entry.type === 'depends_on');
    const forked = ranked.find((entry) => entry.type === 'forked_from');
    expect(dependsOn?.score).toBeCloseTo(SUGGEST_WEIGHTS.allowed + SUGGEST_WEIGHTS.heuristic, 6);
    expect(forked?.score).toBeCloseTo(SUGGEST_WEIGHTS.allowed, 6);
  });

  it('falls back to references when nothing scores', () => {
    const empty = new EdgeTypeRegistry();
    expect(bestEdgeType(empty, 'person', 'person')).toBe(FALLBACK_EDGE_TYPE);
    expect(bestEdgeType(registry, 'person', 'organization')).not.toBe('resolves_to');
  });
});
