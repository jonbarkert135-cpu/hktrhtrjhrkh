/**
 * Browser side of §29: turn a board archive into the file the investigator asked for. The formats
 * themselves live in `@nexus/domain/export/formats` — this module only knows about blobs and the
 * canvas bitmap, so everything else stays testable without a DOM.
 */

import {
  serializeBoardExport,
  toCsv,
  toDot,
  toMarkdown,
  toReportHtml,
  type BoardExportV1,
} from '@nexus/domain';

export const EXPORT_FORMATS = ['json', 'csv', 'markdown', 'graph', 'report', 'png'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  json: 'Board archive (.raven.json)',
  csv: 'Nodes + edges (.csv)',
  markdown: 'Notes (.md)',
  graph: 'Graph (.dot)',
  report: 'Investigation report (.html, printable)',
  png: 'Canvas image (.png)',
};

function safeName(title: string): string {
  const cleaned = title.replaceAll(/[^\p{L}\p{N} ._-]/gu, '').trim();
  return cleaned === '' ? 'board' : cleaned;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** The live canvas bitmap; null when the canvas is not mounted or the browser refuses to encode. */
export async function canvasPng(canvas: HTMLCanvasElement | null): Promise<Blob | null> {
  if (canvas === null) return null;
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/png');
  });
}

async function dataUrl(blob: Blob | null): Promise<string | null> {
  if (blob === null) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export interface ExportRequest {
  archive: BoardExportV1;
  format: ExportFormat;
  /** Canvas element used by the `png` format and as the report cover. */
  canvas?: HTMLCanvasElement | null | undefined;
  summary?: string | undefined;
}

/** Produces the file and hands it to the browser. Returns the filename that was written. */
export async function runExport(request: ExportRequest): Promise<string | null> {
  const name = safeName(request.archive.board.title);
  switch (request.format) {
    case 'json': {
      downloadBlob(
        new Blob([serializeBoardExport(request.archive)], { type: 'application/json' }),
        `${name}.raven.json`,
      );
      return `${name}.raven.json`;
    }
    case 'csv': {
      const { nodes, edges } = toCsv(request.archive);
      downloadBlob(new Blob([nodes], { type: 'text/csv' }), `${name}.nodes.csv`);
      downloadBlob(new Blob([edges], { type: 'text/csv' }), `${name}.edges.csv`);
      return `${name}.nodes.csv`;
    }
    case 'markdown': {
      downloadBlob(
        new Blob([toMarkdown(request.archive)], { type: 'text/markdown' }),
        `${name}.md`,
      );
      return `${name}.md`;
    }
    case 'graph': {
      downloadBlob(
        new Blob([toDot(request.archive)], { type: 'text/vnd.graphviz' }),
        `${name}.dot`,
      );
      return `${name}.dot`;
    }
    case 'report': {
      const cover = await dataUrl(await canvasPng(request.canvas ?? null));
      const html = toReportHtml(request.archive, {
        canvasImage: cover,
        summary: request.summary,
      });
      downloadBlob(new Blob([html], { type: 'text/html' }), `${name}.report.html`);
      return `${name}.report.html`;
    }
    case 'png': {
      const blob = await canvasPng(request.canvas ?? null);
      if (blob === null) return null;
      downloadBlob(blob, `${name}.png`);
      return `${name}.png`;
    }
  }
}
