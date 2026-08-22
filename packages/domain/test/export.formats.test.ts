/**
 * §29 — derived export formats. The archive is built through the real document so the fixtures
 * cannot drift from the schema.
 */

import { describe, expect, it } from 'vitest';

import { createBoardDoc } from '../src/doc/createBoardDoc.ts';
import { addEdges, addNodes } from '../src/doc/mutations.ts';
import { makeEdge } from '../src/entities/edge.ts';
import { makeNode } from '../src/entities/node.ts';
import { exportBoard } from '../src/export/exportBoard.ts';
import { toCsv, toDot, toMarkdown, toReportHtml } from '../src/export/formats.ts';
import { T0 } from './doc-fixtures.ts';

function archive() {
  const doc = createBoardDoc({ boardId: 'b1', title: 'Case "Nord"', now: T0 });
  addNodes(
    doc,
    [
      makeNode({ id: 'n1', x: 0, y: 0, title: 'Suspect, primary', tags: ['osint'] }, T0),
      makeNode({ id: 'n2', x: 10, y: 10, title: 'Domain\nrecord' }, T0),
    ],
    { origin: 'local:create', now: T0 },
  );
  addEdges(doc, [makeEdge({ id: 'e1', from: 'n1', to: 'n2', label: 'owns' }, T0)], {
    origin: 'local:create',
    now: T0,
  });
  return exportBoard(doc, { appVersion: '1.0.0-test', now: T0 });
}

describe('export formats', () => {
  it('quotes CSV cells that contain commas, quotes or newlines', () => {
    const { nodes, edges } = toCsv(archive());
    expect(nodes.split('\r\n')[0]).toBe(
      'id,type,title,status,confidence,tags,source,createdAt,updatedAt',
    );
    expect(nodes).toContain('"Suspect, primary"');
    expect(nodes).toContain('"Domain\nrecord"');
    expect(edges).toContain('e1,related_to,n1,n2,owns,true');
  });

  it('renders Markdown with a node table and resolved edge titles', () => {
    const md = toMarkdown(archive());
    expect(md).toContain('# Case "Nord"');
    expect(md).toContain('| Suspect, primary |');
    expect(md).toContain('Suspect, primary → Domain record — owns (unknown)');
  });

  it('emits DOT with escaped labels', () => {
    const dot = toDot(archive());
    expect(dot.startsWith('digraph board {')).toBe(true);
    expect(dot).toContain('"n1" -> "n2" [label="owns"];');
    expect(dot).toContain('label="Suspect, primary"');
  });

  it('builds a self-contained printable report and escapes HTML', () => {
    const html = toReportHtml(archive(), {
      summary: '<b>watch</b>',
      canvasImage: 'data:image/png;base64,AAA',
    });
    expect(html).toContain('<title>Case &quot;Nord&quot;</title>');
    expect(html).toContain('&lt;b&gt;watch&lt;/b&gt;');
    expect(html).toContain('src="data:image/png;base64,AAA"');
    expect(html).toContain('@media print');
    expect(html).not.toContain('<script');
  });

  it('omits the cover and summary when they are not provided', () => {
    const html = toReportHtml(archive());
    expect(html).not.toContain('class="cover"');
    expect(html).not.toContain('<h2>Summary</h2>');
  });
});
