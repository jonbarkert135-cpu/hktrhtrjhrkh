import { describe, expect, it } from 'vitest';

import {
  RouteCache,
  nodeGeomHash,
  quantize,
  route,
  routeKey,
  waypointsHash,
  withRouteDefaults,
  type EdgeGeometry,
  type NodeBox,
  type RouteKeyInput,
} from '../src/edges/index.ts';

const source: NodeBox = { id: 'a', x: 0, y: 0, w: 160, h: 90, radius: 10 };
const target: NodeBox = { id: 'b', x: 600, y: 320, w: 160, h: 90, radius: 10 };
const geometry = (): EdgeGeometry => route(withRouteDefaults({ source, target, mode: 'straight' }));

const keyInput = (patch: Partial<RouteKeyInput> = {}): RouteKeyInput => ({
  edgeId: 'e1',
  version: 3,
  source,
  target,
  resolvedMode: 'curved',
  siblingIndex: 0,
  siblingCount: 1,
  manualRoute: false,
  waypoints: [],
  obstacleEpoch: 0,
  quality: 'full',
  ...patch,
});

describe('routeKey', () => {
  it('quantizes node geometry to one canvas unit', () => {
    expect(quantize(10.4)).toBe(10);
    expect(nodeGeomHash(source)).toBe(nodeGeomHash({ ...source, x: 0.3 }));
    expect(routeKey(keyInput())).toBe(routeKey(keyInput({ source: { ...source, y: 0.4 } })));
  });

  it('changes when anything the router reads changes', () => {
    const base = routeKey(keyInput());
    expect(routeKey(keyInput({ version: 4 }))).not.toBe(base);
    expect(routeKey(keyInput({ resolvedMode: 'orthogonal' }))).not.toBe(base);
    expect(routeKey(keyInput({ siblingCount: 2 }))).not.toBe(base);
    expect(routeKey(keyInput({ quality: 'draft' }))).not.toBe(base);
    expect(routeKey(keyInput({ obstacleEpoch: 1 }))).not.toBe(base);
    expect(routeKey(keyInput({ source: { ...source, x: 40 } }))).not.toBe(base);
  });

  it('keys a manual route on its waypoints instead of the obstacle epoch', () => {
    const manual = keyInput({ manualRoute: true, waypoints: [{ x: 10, y: 20 }] });
    expect(routeKey(manual)).toContain(waypointsHash(manual.waypoints));
    expect(routeKey({ ...manual, obstacleEpoch: 99 })).toBe(routeKey(manual));
  });
});

describe('RouteCache', () => {
  const edge = { id: 'e1', from: 'a', to: 'b' };

  it('stores, hits and reports statistics', () => {
    const cache = new RouteCache();
    expect(cache.get('k')).toBeUndefined();
    cache.set('k', geometry(), edge);
    expect(cache.get('k')).toBeDefined();
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1, size: 1 });
  });

  it('drops the previous entry when an edge is re-keyed', () => {
    const cache = new RouteCache();
    cache.set('k1', geometry(), edge);
    cache.set('k2', geometry(), edge);
    expect(cache.size).toBe(1);
    expect(cache.get('k1')).toBeUndefined();
  });

  it('evicts the least recently used entry at capacity', () => {
    const cache = new RouteCache(2);
    cache.set('k1', geometry(), { id: 'e1', from: 'a', to: 'b' });
    cache.set('k2', geometry(), { id: 'e2', from: 'a', to: 'b' });
    cache.get('k1');
    cache.set('k3', geometry(), { id: 'e3', from: 'a', to: 'b' });
    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k1')).toBeDefined();
  });

  it('invalidates only the edges incident to a moved node', () => {
    const cache = new RouteCache();
    cache.set('k1', geometry(), { id: 'e1', from: 'a', to: 'b' });
    cache.set('k2', geometry(), { id: 'e2', from: 'c', to: 'd' });
    expect(cache.invalidateNode('a')).toBe(1);
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('k2')).toBeDefined();
    expect(cache.invalidateNode('zzz')).toBe(0);
    expect(cache.invalidateEdge('unknown')).toBe(0);
  });

  it('bumps the obstacle epoch and clears', () => {
    const cache = new RouteCache();
    expect(cache.obstacleEpoch).toBe(0);
    expect(cache.bumpObstacleEpoch()).toBe(1);
    cache.set('k1', geometry(), edge);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
