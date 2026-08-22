/**
 * Derived export formats (P3 §29): CSV, Markdown, graph (DOT) and a printable investigation
 * report. All of them are pure functions over the already-deterministic `BoardExportV1`, so the
 * canvas, the API and the tests share one code path and every format stays reproducible.
 */

import type { BoardExportV1 } from './schema.v1.ts';

const NODE_COLUMNS = [
  'id',
  'type',
  'title',
  'status',
  'confidence',
  'tags',
  'source',
  'createdAt',
  'updatedAt',
] as const;

const EDGE_COLUMNS = [
  'id',
  'type',
  'source',
  'target',
  'label',
  'directed',
  'confidence',
  'weight',
] as const;

/** RFC 4180: quote when the value contains a delimiter, a quote or a newline. */
function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRows(rows: readonly (readonly (string | number | boolean)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export interface CsvExport {
  nodes: string;
  edges: string;
}

export function toCsv(archive: BoardExportV1): CsvExport {
  const nodes = csvRows([
    NODE_COLUMNS,
    ...archive.nodes.map((node) => [
      node.id,
      node.type,
      node.title,
      node.status,
      node.confidence,
      node.tags.join(' '),
      node.provenance.source ?? '',
      node.createdAt,
      node.updatedAt,
    ]),
  ]);
  const edges = csvRows([
    EDGE_COLUMNS,
    ...archive.edges.map((edge) => [
      edge.id,
      edge.type,
      edge.source.nodeId,
      edge.target.nodeId,
      edge.label,
      edge.directed,
      edge.confidence,
      edge.weight,
    ]),
  ]);
  return { nodes, edges };
}

function titleOf(archive: BoardExportV1, nodeId: string): string {
  const node = archive.nodes.find((candidate) => candidate.id === nodeId);
  return node === undefined ? nodeId : node.title || `${node.type} ${node.id}`;
}

/** Markdown escaping is limited to the characters that would break a table cell or a heading. */
function md(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function toMarkdown(archive: BoardExportV1): string {
  const lines: string[] = [
    `# ${archive.board.title || 'Untitled board'}`,
    '',
    `_Exported ${archive.exportedAt} — ${String(archive.nodes.length)} nodes, ${String(archive.edges.length)} connections._`,
    '',
    '## Nodes',
    '',
    '| Title | Type | Confidence | Tags | Source |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const node of archive.nodes) {
    lines.push(
      `| ${md(node.title || node.id)} | ${md(node.type)} | ${node.confidence} | ${md(node.tags.join(', '))} | ${md(node.provenance.source ?? '')} |`,
    );
  }
  lines.push('', '## Connections', '');
  if (archive.edges.length === 0) lines.push('_No connections._');
  for (const edge of archive.edges) {
    const arrow = edge.directed ? '→' : '↔';
    const label = edge.label || edge.type;
    lines.push(
      `- ${md(titleOf(archive, edge.source.nodeId))} ${arrow} ${md(titleOf(archive, edge.target.nodeId))} — ${md(label)} (${edge.confidence})`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function dotQuote(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Graphviz DOT: the one graph interchange format every graph tool (and Gephi via import) reads. */
export function toDot(archive: BoardExportV1): string {
  const lines = ['digraph board {', '  rankdir=LR;'];
  for (const node of archive.nodes) {
    lines.push(
      `  ${dotQuote(node.id)} [label=${dotQuote(node.title || node.type)}, tooltip=${dotQuote(node.type)}];`,
    );
  }
  for (const edge of archive.edges) {
    const attrs = [`label=${dotQuote(edge.label || edge.type)}`];
    if (!edge.directed) attrs.push('dir=none');
    lines.push(
      `  ${dotQuote(edge.source.nodeId)} -> ${dotQuote(edge.target.nodeId)} [${attrs.join(', ')}];`,
    );
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface ReportOptions {
  /** Optional PNG/SVG data URL of the canvas, embedded as the report cover. */
  canvasImage?: string | null | undefined;
  /** Investigator-written summary shown above the findings. */
  summary?: string | undefined;
}

/**
 * "Export Investigation": a single self-contained HTML file, styled for both screen and paper
 * (`@media print`). No external assets, no script — it is a document, so it can be mailed as
 * evidence and printed to PDF by the browser.
 */
export function toReportHtml(archive: BoardExportV1, options: ReportOptions = {}): string {
  const title = archive.board.title || 'Untitled investigation';
  const byType = new Map<string, number>();
  for (const node of archive.nodes) byType.set(node.type, (byType.get(node.type) ?? 0) + 1);

  const cover =
    options.canvasImage === undefined || options.canvasImage === null
      ? ''
      : `<figure class="cover"><img alt="Canvas overview" src="${escapeHtml(options.canvasImage)}" /><figcaption>Canvas overview</figcaption></figure>`;

  const summary =
    options.summary === undefined || options.summary === ''
      ? ''
      : `<section><h2>Summary</h2><p>${escapeHtml(options.summary)}</p></section>`;

  const findings = archive.nodes
    .map(
      (node) => `<article class="finding">
      <h3>${escapeHtml(node.title || node.id)}</h3>
      <p class="meta">${escapeHtml(node.type)} · confidence ${escapeHtml(node.confidence)}${node.tags.length > 0 ? ` · ${escapeHtml(node.tags.join(', '))}` : ''}</p>
      ${node.provenance.source === null ? '' : `<p class="src">${escapeHtml(node.provenance.source)}</p>`}
    </article>`,
    )
    .join('\n');

  const relations = archive.edges
    .map(
      (edge) =>
        `<li>${escapeHtml(titleOf(archive, edge.source.nodeId))} ${edge.directed ? '→' : '↔'} ${escapeHtml(titleOf(archive, edge.target.nodeId))} — ${escapeHtml(edge.label || edge.type)} <em>(${escapeHtml(edge.confidence)})</em></li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 46rem; padding: 3rem 1.5rem; font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; color: #16181d; }
  h1 { font-size: 2rem; margin: 0 0 .25rem; }
  .meta { color: #5b6270; font-size: .85rem; margin: .15rem 0; }
  .cover img { width: 100%; border: 1px solid #d8dbe2; border-radius: .5rem; }
  .finding { border-top: 1px solid #e5e7eb; padding: .75rem 0; break-inside: avoid; }
  .src { word-break: break-all; font-size: .85rem; color: #3c4657; }
  ul { padding-left: 1.1rem; }
  @media print {
    body { max-width: none; padding: 0; font-size: 11pt; }
    .finding, li, figure { break-inside: avoid; }
    a[href]::after { content: " (" attr(href) ")"; font-size: 9pt; }
  }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Exported ${escapeHtml(archive.exportedAt)} · ${String(archive.nodes.length)} nodes · ${String(archive.edges.length)} connections</p>
  <p class="meta">${escapeHtml([...byType.entries()].map(([type, count]) => `${type}: ${String(count)}`).join(' · '))}</p>
</header>
${cover}
${summary}
<section><h2>Findings</h2>
${findings}
</section>
<section><h2>Relationships</h2>
${archive.edges.length === 0 ? '<p class="meta">No connections recorded.</p>' : `<ul>${relations}</ul>`}
</section>
</body>
</html>
`;
}
