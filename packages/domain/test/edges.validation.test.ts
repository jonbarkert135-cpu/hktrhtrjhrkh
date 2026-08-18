import { describe, expect, it } from 'vitest';

import { makeEdge, type BoardEdge } from '../src/entities/edge.ts';
import {
  EDGE_LABEL_MAX,
  EdgeTypeRegistry,
  registerEdgeBuiltins,
  validateEdgeCandidate,
  type EdgeCandidate,
} from '../src/edges/index.ts';

const NOW = '2026-08-18T00:00:00.000Z';
const registry: EdgeTypeRegistry = registerEdgeBuiltins(new EdgeTypeRegistry());

const candidate = (patch: Partial<EdgeCandidate> = {}): EdgeCandidate => ({
  type: 'works_at',
  sourceNodeId: 'n1',
  targetNodeId: 'n2',
  sourceNodeType: 'person',
  targetNodeType: 'organization',
  directed: true,
  ...patch,
});

const codesOf = (result: { issues: readonly { code: string }[] }): string[] =>
  result.issues.map((issue) => issue.code);

describe('edge validation', () => {
  it('accepts a well-formed relationship', () => {
    const result = validateEdgeCandidate(registry, candidate());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.duplicateOf).toBeNull();
    expect(result.forceUnknownConfidence).toBe(false);
  });

  it('rejects a self-loop on a type that forbids it', () => {
    const result = validateEdgeCandidate(registry, candidate({ targetNodeId: 'n1' }));
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('self-loop');
  });

  it('allows a self-loop on the types that permit one', () => {
    const result = validateEdgeCandidate(
      registry,
      candidate({ type: 'knows', targetNodeId: 'n1', targetNodeType: 'person' }),
    );
    expect(codesOf(result)).not.toContain('self-loop');
    expect(result.ok).toBe(true);
  });

  it('rejects a duplicate and points at the existing relationship', () => {
    const existing: BoardEdge[] = [
      makeEdge({ id: 'existing', from: 'n1', to: 'n2', type: 'works_at' }, NOW),
    ];
    const result = validateEdgeCandidate(registry, candidate(), existing);
    expect(result.ok).toBe(false);
    expect(result.duplicateOf).toBe('existing');
    expect(result.issues.find((issue) => issue.code === 'duplicate-edge')?.edgeId).toBe('existing');
  });

  it('matches a mirrored undirected duplicate', () => {
    const existing: BoardEdge[] = [
      { ...makeEdge({ id: 'mirror', from: 'n2', to: 'n1', type: 'knows' }, NOW), directed: false },
    ];
    const result = validateEdgeCandidate(
      registry,
      candidate({
        type: 'knows',
        directed: false,
        sourceNodeType: 'person',
        targetNodeType: 'person',
      }),
      existing,
    );
    expect(result.duplicateOf).toBe('mirror');
  });

  it('ignores archived and differently typed relationships when detecting duplicates', () => {
    const existing: BoardEdge[] = [
      {
        ...makeEdge({ id: 'archived', from: 'n1', to: 'n2', type: 'works_at' }, NOW),
        status: 'archived',
      },
      makeEdge({ id: 'other-type', from: 'n1', to: 'n2', type: 'member_of' }, NOW),
      makeEdge({ id: 'other-nodes', from: 'n1', to: 'n3', type: 'works_at' }, NOW),
    ];
    const result = validateEdgeCandidate(registry, candidate(), existing);
    expect(result.ok).toBe(true);
    expect(result.duplicateOf).toBeNull();
  });

  it('warns about an unusual pair instead of blocking it', () => {
    const result = validateEdgeCandidate(
      registry,
      candidate({ sourceNodeType: 'image', targetNodeType: 'file' }),
    );
    expect(result.ok).toBe(true);
    expect(result.forceUnknownConfidence).toBe(true);
    expect(result.issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('warns about an unregistered type and validates it as custom', () => {
    const result = validateEdgeCandidate(registry, candidate({ type: 'invented' }));
    expect(codesOf(result)).toContain('unknown-edge-type');
    expect(result.ok).toBe(true);
  });

  it('rejects an over-long label', () => {
    const result = validateEdgeCandidate(
      registry,
      candidate({ label: 'x'.repeat(EDGE_LABEL_MAX + 1) }),
    );
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('label-too-long');
  });

  it('rejects an inverted validity range', () => {
    const result = validateEdgeCandidate(
      registry,
      candidate({ validFrom: '2024-01-01T00:00:00.000Z', validTo: '2023-01-01T00:00:00.000Z' }),
    );
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('time-range-inverted');
  });

  it('accepts an open-ended validity range', () => {
    const result = validateEdgeCandidate(
      registry,
      candidate({ validFrom: '2024-01-01T00:00:00.000Z', validTo: null }),
    );
    expect(result.ok).toBe(true);
  });

  it('requires provenance on tool- and assistant-created relationships', () => {
    const missing = validateEdgeCandidate(registry, candidate({ provenanceKind: 'tool' }));
    expect(missing.ok).toBe(false);
    expect(codesOf(missing)).toContain('missing-provenance');

    const present = validateEdgeCandidate(
      registry,
      candidate({ provenanceKind: 'ai', provenanceTool: 'assistant' }),
    );
    expect(present.ok).toBe(true);
  });

  it('does not demand a tool name from a hand-drawn relationship', () => {
    const result = validateEdgeCandidate(registry, candidate({ provenanceKind: 'manual' }));
    expect(codesOf(result)).not.toContain('missing-provenance');
  });
});
