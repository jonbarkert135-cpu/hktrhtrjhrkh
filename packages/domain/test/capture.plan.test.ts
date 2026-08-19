/**
 * P6 §5.2/§5.3/§5.13 and §12.6 — the plan is what every capture door goes through, so this suite
 * pins the grid, the text/note split, provenance and the "one paste = one undo step" rule.
 */

import { describe, expect, it } from 'vitest';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import { listNodes } from '../src/doc/mutations.ts';
import { createBoardHistory } from '../src/history/undoManager.ts';
import {
  CAPTURE_GRID_GAP,
  createNodesFromPlan,
  occupiedBoxes,
  planCapture,
} from '../src/capture/plan.ts';
import { detectTransfer } from '../src/capture/detect.ts';
import { TEXT_NODE_MAX_CHARS } from '../src/capture/parse.ts';
import { seqIds, T0 } from './doc-fixtures.ts';

const at = { x: 0, y: 0 };

const urls = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `https://site${String(i)}.example/page`);

describe('planCapture', () => {
  it('turns a single URL into one website node with the URL as its provenance source', () => {
    const plan = planCapture(detectTransfer({ text: 'https://a.example/x' }), {
      at,
      origin: 'paste',
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.type).toBe('website');
    expect(plan.items[0]?.source).toBe('https://a.example/x');
    expect(plan.message).toBe('Added 1 link');
  });

  it('lays 12 URLs out in a non-overlapping grid with a 24 px gap', () => {
    const plan = planCapture(detectTransfer({ text: urls(12).join('\n') }), {
      at,
      origin: 'paste',
    });
    expect(plan.items).toHaveLength(12);
    const [first, second] = plan.items;
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBe((first?.w ?? 0) + CAPTURE_GRID_GAP);
    for (const a of plan.items) {
      for (const b of plan.items) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('caps at 50 links and offers the list import instead of truncating silently', () => {
    const detection = detectTransfer({ text: urls(500).join('\n') });
    const plan = planCapture(detection, { at, origin: 'paste' });
    expect(plan.items).toHaveLength(50);
    expect(plan.overflow).toEqual({ total: 500, kept: 50 });
    expect(plan.message).toContain('import the rest as a list');

    const asList = planCapture(detection, { at, origin: 'paste', asList: true });
    expect(asList.items).toHaveLength(1);
    expect(asList.items[0]?.type).toBe('note');
    expect(String(asList.items[0]?.data['plain'])).toContain('https://site49.example/page');
    expect(asList.message).toBe('Imported 500 links as a list.');
  });

  it('splits pasted text at 280 characters into text and note', () => {
    const short = planCapture(detectTransfer({ text: 'x'.repeat(TEXT_NODE_MAX_CHARS) }), {
      at,
      origin: 'paste',
    });
    const long = planCapture(detectTransfer({ text: 'x'.repeat(TEXT_NODE_MAX_CHARS + 1) }), {
      at,
      origin: 'paste',
    });
    expect(short.items[0]?.type).toBe('text');
    expect(long.items[0]?.type).toBe('note');
  });

  it('keeps the pasted text as the caption of an image and carries the file through', () => {
    const file = { name: 'shot.png', type: 'image/png', size: 10 };
    const plan = planCapture(detectTransfer({ files: [file], text: 'Figure 2' }), {
      at,
      origin: 'paste',
    });
    expect(plan.items[0]?.type).toBe('image');
    expect(plan.items[0]?.data['alt']).toBe('Figure 2');
    expect(plan.items[0]?.file).toEqual(file);
  });

  it('plans a non-image file as a file node', () => {
    const plan = planCapture(
      detectTransfer({ files: [{ name: 'r.pdf', type: 'application/pdf', size: 3 }] }),
      { at, origin: 'drop' },
    );
    expect(plan.items[0]?.type).toBe('file');
    expect(plan.message).toBe('Added 1 file');
  });

  it('plans nothing for an empty clipboard', () => {
    const plan = planCapture(detectTransfer({}), { at, origin: 'paste' });
    expect(plan.items).toEqual([]);
    expect(plan.message).toBeNull();
  });

  it('steps aside instead of burying an existing node', () => {
    const plan = planCapture(detectTransfer({ text: 'https://a.example/' }), {
      at,
      origin: 'paste',
      occupied: [{ x: -200, y: -200, w: 400, h: 400 }],
    });
    const item = plan.items[0];
    const clash =
      (item?.x ?? 0) < 200 &&
      -200 < (item?.x ?? 0) + (item?.w ?? 0) &&
      (item?.y ?? 0) < 200 &&
      -200 < (item?.y ?? 0) + (item?.h ?? 0);
    expect(clash).toBe(false);
  });
});

describe('createNodesFromPlan', () => {
  it('creates 12 nodes as one undo step and records capture provenance', () => {
    const doc = createBoardDoc({ boardId: 'b1', now: T0 });
    const history = createBoardHistory(doc);
    const plan = planCapture(detectTransfer({ text: urls(12).join('\n') }), {
      at,
      origin: 'paste',
    });
    const ids = createNodesFromPlan(doc, plan, { now: T0, origin: 'paste', makeId: seqIds('n') });

    expect(ids).toHaveLength(12);
    expect(listNodes(doc)).toHaveLength(12);
    const node = listNodes(doc)[0];
    expect(node?.provenance.kind).toBe('paste');
    expect(node?.provenance.source).toBe('https://site0.example/page');
    expect(node?.provenance.observedAt).toBe(T0);
    expect(node?.provenance['capturedVia']).toBe('paste');

    history.undo();
    expect(listNodes(doc)).toHaveLength(0);
  });

  it('maps the extension and quick-add doors onto the provenance vocabulary', () => {
    const doc = createBoardDoc({ boardId: 'b1', now: T0 });
    createNodesFromPlan(
      doc,
      planCapture(detectTransfer({ text: 'https://a.example/' }), { at, origin: 'extension' }),
      { now: T0, origin: 'extension', makeId: seqIds('e') },
    );
    createNodesFromPlan(
      doc,
      planCapture(detectTransfer({ text: 'a note' }), {
        at: { x: 900, y: 900 },
        origin: 'quick-add',
      }),
      { now: T0, origin: 'quick-add', makeId: seqIds('q') },
    );
    const kinds = listNodes(doc).map((node) => [
      node.provenance.kind,
      node.provenance['capturedVia'],
    ]);
    expect(kinds).toContainEqual(['import', 'extension']);
    expect(kinds).toContainEqual(['manual', 'quick-add']);
  });

  it('writes nothing for an empty plan and reads the occupied boxes back', () => {
    const doc = createBoardDoc({ boardId: 'b1', now: T0 });
    expect(
      createNodesFromPlan(
        doc,
        { items: [], message: null, overflow: null },
        {
          now: T0,
          origin: 'paste',
        },
      ),
    ).toEqual([]);
    createNodesFromPlan(
      doc,
      planCapture(detectTransfer({ text: 'https://a.example/' }), { at, origin: 'paste' }),
      { now: T0, origin: 'paste', makeId: seqIds('n') },
    );
    expect(occupiedBoxes(doc)).toHaveLength(1);
    expect(occupiedBoxes(doc)[0]?.w).toBeGreaterThan(0);
  });
});
