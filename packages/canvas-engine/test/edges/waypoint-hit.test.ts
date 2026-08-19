/**
 * The engine is the hit-test authority for waypoints too (07 §8.3): they are grabbable only while
 * their edge is selected, and they win over the node and edge below them.
 */

import { describe, expect, it } from 'vitest';

import { gridScene, harness } from '../engine.support';
import { makeEdge } from '../render-fixtures';
import { runPointerScript } from '../../src/testing';
import type { Intent } from '../../src/types';

function boardWithWaypoint() {
  const scene = gridScene(2, 2);
  const edge = {
    ...makeEdge(0, 'n0', 'n1'),
    id: 'e1',
    waypoints: [{ x: 300, y: 300 }],
  };
  const h = harness({ ...scene, edges: [edge] });
  const intents: Intent[] = [];
  h.engine.on('intent', (intent) => intents.push(intent));
  return { ...h, intents, edge };
}

describe('waypoint hit-testing', () => {
  it('grabs a waypoint of the selected edge', () => {
    const { engine, clock, intents } = boardWithWaypoint();
    engine.camera.setState({ x: 0, y: 0, zoom: 1 }, 'user');
    engine.selection.set(['e1']);
    engine.tick();

    runPointerScript(engine, clock, [
      { t: 'down', at: { x: 302, y: 301 } },
      { t: 'move', at: { x: 360, y: 320 } },
      { t: 'up', at: { x: 360, y: 320 } },
    ]);

    const moves = intents.filter((i) => i.t === 'edge-waypoint');
    expect(moves.map((i) => (i.t === 'edge-waypoint' && i.op === 'move' ? i.phase : ''))).toEqual([
      'start',
      'update',
      'end',
    ]);
  });

  it('ignores the waypoint when the edge is not selected', () => {
    const { engine, clock, intents } = boardWithWaypoint();
    engine.camera.setState({ x: 0, y: 0, zoom: 1 }, 'user');
    engine.tick();

    runPointerScript(engine, clock, [
      { t: 'down', at: { x: 302, y: 301 } },
      { t: 'up', at: { x: 302, y: 301 } },
    ]);
    expect(intents.some((i) => i.t === 'edge-waypoint')).toBe(false);
  });
});
