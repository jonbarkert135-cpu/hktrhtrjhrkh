import { describe, expect, it } from 'vitest';

import { EdgeSchema, makeEdge } from '../src/entities/edge.ts';
import { AssetSchema, BoardMetaSchema, makeGroup } from '../src/entities/group.ts';
import { NodeSchema, UNKNOWN_NODE_TYPE, makeNode } from '../src/entities/node.ts';
import { ProvenanceSchema, manualProvenance } from '../src/entities/provenance.ts';
import { T0 } from './doc-fixtures.ts';

describe('entity schemas', () => {
  it('fills node defaults and keeps unknown keys', () => {
    const node = makeNode({ id: 'n1', x: 1, y: 2 }, T0);
    expect([node.type, node.w, node.status, node.version]).toEqual([
      UNKNOWN_NODE_TYPE,
      280,
      'active',
      1,
    ]);
    const parsed = NodeSchema.parse({ ...node, pluginField: 'kept' });
    expect((parsed as Record<string, unknown>).pluginField).toBe('kept');
  });

  it('rejects impossible geometry', () => {
    expect(() => makeNode({ id: 'n1', x: Number.NaN, y: 0 }, T0)).toThrow();
    expect(() => NodeSchema.parse({ ...makeNode({ id: 'n1', x: 0, y: 0 }, T0), w: 0 })).toThrow();
  });

  it('fills edge defaults', () => {
    const edge = makeEdge({ id: 'e1', from: 'n1', to: 'n2' }, T0);
    expect(edge.source).toEqual({ nodeId: 'n1', port: 'auto', offset: 0.5, anchorKey: null });
    expect(edge.style.labelPosition).toBe(0.5);
    expect(EdgeSchema.parse(edge).directed).toBe(true);
  });

  it('fills group and asset defaults', () => {
    const group = makeGroup({ id: 'g1', x: 0, y: 0, w: 10, h: 10 }, T0);
    expect([group.kind, group.padding, group.autoLayout]).toEqual(['frame', 24, 'none']);
    expect(AssetSchema.parse({ id: 'f1', createdAt: T0 }).state).toBe('local');
  });

  it('normalises provenance and coerces an unknown kind', () => {
    const provenance = manualProvenance(T0, 'u_1');
    expect(provenance).toMatchObject({ kind: 'manual', actorId: 'u_1', confidence: 'unknown' });
    expect(ProvenanceSchema.parse({ kind: 'telepathy' }).kind).toBe('manual');
    expect(() => ProvenanceSchema.parse({ kind: 'manual', observedAt: 'yesterday' })).toThrow();
  });

  it('validates board meta', () => {
    const meta = BoardMetaSchema.parse({
      schemaVersion: 1,
      boardId: 'b1',
      createdAt: T0,
      updatedAt: T0,
    });
    expect([meta.title, meta.background, meta.defaultEdgeRouting]).toEqual([
      'Untitled board',
      'dots',
      'smart',
    ]);
  });
});
