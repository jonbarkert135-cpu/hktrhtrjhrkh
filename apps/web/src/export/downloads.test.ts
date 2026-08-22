import { createBoardDoc, exportBoard, addNodes, makeNode } from '@nexus/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runExport } from './downloads.ts';

const T0 = '2026-08-17T12:00:00.000Z';

function archive() {
  const doc = createBoardDoc({ boardId: 'b1', title: 'Case / One', now: T0 });
  addNodes(doc, [makeNode({ id: 'n1', x: 0, y: 0, title: 'Alpha' }, T0)], {
    origin: 'local:create',
    now: T0,
  });
  return exportBoard(doc, { appVersion: '1.0.0-test', now: T0 });
}

const clicked: { name: string; type: string }[] = [];

beforeEach(() => {
  clicked.length = 0;
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ name: this.download, type: '' });
  });
});

describe('runExport', () => {
  it('writes one file per simple format with a filesystem-safe name', async () => {
    for (const format of ['json', 'markdown', 'graph'] as const) {
      await runExport({ archive: archive(), format });
    }
    expect(clicked.map((entry) => entry.name)).toEqual([
      'Case  One.raven.json',
      'Case  One.md',
      'Case  One.dot',
    ]);
  });

  it('writes nodes and edges as two CSV files', async () => {
    await runExport({ archive: archive(), format: 'csv' });
    expect(clicked.map((entry) => entry.name)).toEqual([
      'Case  One.nodes.csv',
      'Case  One.edges.csv',
    ]);
  });

  it('exports a report without a canvas', async () => {
    const written = await runExport({ archive: archive(), format: 'report', canvas: null });
    expect(written).toBe('Case  One.report.html');
  });

  it('reports failure instead of writing an empty PNG when the canvas is missing', async () => {
    expect(await runExport({ archive: archive(), format: 'png', canvas: null })).toBeNull();
    expect(clicked).toHaveLength(0);
  });
});
