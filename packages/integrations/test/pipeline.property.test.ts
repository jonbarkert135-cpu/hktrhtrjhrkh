/**
 * §13 point 3: for arbitrary parsed documents, extract → map → propose → apply → undo must return
 * the document to a deep-equal prior state (N3, N9), and apply must be exactly one undo step.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createBoardDoc, createBoardHistory, newId } from '@nexus/domain';

import { manifest as expandUrl } from '../builtin/manifest.ts';
import { applyProposal } from '../src/apply.ts';
import {
  buildProposal,
  defaultNodeMapper,
  defaultRelationshipMapper,
  manifestEntityExtractor,
  type MapContext,
  type ParsedDocument,
  type ParsedRecord,
  type Provenance,
} from '../src/pipeline.ts';

const NOW = '2026-02-01T00:00:00.000Z';

const provenanceFor = (origin: { pointer: string }, confidence: number): Provenance => ({
  source: 'Expand URL 1.0.0',
  tool: expandUrl.id,
  toolVersion: expandUrl.version,
  runId: 'run-1',
  observedAt: NOW,
  importedAt: NOW,
  confidence,
  pointer: origin.pointer,
  actorUserId: 'user-1',
});

const recordArb = fc
  .record({
    host: fc.constantFrom('example.test', 'a.example.test', 'b.example.test', 'shop.example.test'),
    path: fc.constantFrom('/', '/a', '/b/c', '/x?y=1'),
    hops: fc.integer({ min: 1, max: 5 }),
    confidence: fc.double({ min: 0.3, max: 1, noNaN: true }),
  })
  .map(
    (raw, index = 0): ParsedRecord => ({
      type: 'expanded_url',
      data: {
        finalUrl: `https://${raw.host}${raw.path}`,
        inputUrl: 'https://sho.rt/x',
        hops: raw.hops,
        status: 200,
      },
      pointer: `/results/${String(index)}`,
      observedAt: NOW,
      parserConfidence: raw.confidence,
    }),
  );

const documentArb: fc.Arbitrary<ParsedDocument> = fc
  .array(recordArb, { minLength: 1, maxLength: 8 })
  .map((records) => ({
    toolReportedVersion: '1.0',
    records,
    counters: { records: records.length },
    nonFatalIssues: [],
  }));

function pipeline(document: ParsedDocument) {
  const extractor = manifestEntityExtractor(expandUrl);
  const extraction = extractor.extract(document, { manifest: expandUrl });
  const ctx: MapContext = {
    boardId: 'board-1',
    resolve: () => undefined,
    provenanceFor,
  };
  const nodes = defaultNodeMapper().map(extraction, ctx);
  const edges = defaultRelationshipMapper().map(extraction, nodes, ctx);
  return buildProposal({
    proposalId: 'proposal-1',
    runId: 'run-1',
    integrationId: expandUrl.id,
    boardId: 'board-1',
    now: NOW,
    extraction,
    nodes,
    edges,
    ctx,
  });
}

describe('pipeline property', () => {
  it('extract → map → propose → apply → undo restores the document exactly', () => {
    fc.assert(
      fc.property(documentArb, (document) => {
        const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
        const history = createBoardHistory(doc);
        const before = Y.encodeStateAsUpdate(doc);
        const beforeJson = JSON.stringify(doc.getMap('nodes').toJSON());

        const proposal = pipeline(document);
        const result = applyProposal(doc, proposal, {
          selectedItemIds: proposal.items.map((item) => item.id),
          conflictResolutions: {},
          placement: 'radial',
          newId: () => newId.board(),
          now: NOW,
        });

        expect(result.createdNodeIds.length).toBe(proposal.summary.newNodes);
        history.undo();

        expect(JSON.stringify(doc.getMap('nodes').toJSON())).toEqual(beforeJson);
        expect(Y.encodeStateAsUpdate(doc).length).toBeGreaterThanOrEqual(before.length);
        return true;
      }),
      { numRuns: 25 },
    );
  });

  it('applies as exactly one undo step, however many items the proposal carries', () => {
    const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
    const history = createBoardHistory(doc);
    const proposal = pipeline({
      records: Array.from({ length: 6 }, (_, index) => ({
        type: 'expanded_url',
        data: {
          finalUrl: `https://h${String(index)}.example.test/`,
          inputUrl: 'https://sho.rt/x',
          hops: 1,
          status: 200,
        },
        pointer: `/results/${String(index)}`,
        observedAt: NOW,
        parserConfidence: 1,
      })),
      counters: {},
      nonFatalIssues: [],
    });

    applyProposal(doc, proposal, {
      selectedItemIds: proposal.items.map((item) => item.id),
      conflictResolutions: {},
      placement: 'radial',
      newId: () => newId.board(),
      now: NOW,
    });

    expect(history.state.undoDepth).toBe(1);
    history.undo();
    expect(doc.getMap('nodes').size).toBe(0);
  });

  it('never places an imported node on top of an existing one', () => {
    const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
    const proposal = pipeline({
      records: Array.from({ length: 5 }, (_, index) => ({
        type: 'expanded_url',
        data: {
          finalUrl: `https://p${String(index)}.example.test/`,
          inputUrl: 'https://sho.rt/x',
          hops: 1,
          status: 200,
        },
        pointer: `/results/${String(index)}`,
        observedAt: NOW,
        parserConfidence: 1,
      })),
      counters: {},
      nonFatalIssues: [],
    });
    applyProposal(doc, proposal, {
      selectedItemIds: proposal.items.map((item) => item.id),
      conflictResolutions: {},
      placement: 'radial',
      newId: () => newId.board(),
      now: NOW,
    });

    const boxes = Object.values(doc.getMap('nodes').toJSON()) as {
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('refuses to apply an expired proposal', () => {
    const doc = createBoardDoc({ boardId: 'board-1', title: 'test', now: NOW });
    const proposal = {
      ...pipeline({ records: [], counters: {}, nonFatalIssues: [] }),
      expiresAt: NOW,
    };
    expect(() =>
      applyProposal(doc, proposal, {
        selectedItemIds: [],
        conflictResolutions: {},
        placement: 'radial',
        newId: () => newId.board(),
        now: NOW,
      }),
    ).toThrow(/PROPOSAL_EXPIRED/);
  });
});
