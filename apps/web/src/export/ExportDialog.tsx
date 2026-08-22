/**
 * §29 "Export Investigation": one dialog for every output format. The summary field is only used
 * by the report, so it is shown only when the report is selected — nothing else to configure.
 */

import type { BoardExportV1 } from '@nexus/domain';
import { Banner, Button, Dialog } from '@nexus/ui';
import { useState } from 'react';

import { EXPORT_FORMATS, EXPORT_LABELS, runExport, type ExportFormat } from './downloads.ts';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Built lazily so an open board is not serialised until the user actually exports. */
  buildArchive: () => BoardExportV1;
  canvas?: () => HTMLCanvasElement | null;
}

export function ExportDialog({ open, onOpenChange, buildArchive, canvas }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('json');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    try {
      const written = await runExport({
        archive: buildArchive(),
        format,
        canvas: canvas?.() ?? null,
        summary: summary.trim() === '' ? undefined : summary.trim(),
      });
      if (written === null) {
        setError('The canvas image is not available on this device.');
        return;
      }
      setError(null);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The export failed.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export"
      description="Everything is generated on this device; nothing is uploaded."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button data-testid="export-run" onClick={() => void submit()}>
            Export
          </Button>
        </>
      }
    >
      {error !== null ? (
        <Banner kind="danger" title="Nothing was exported">
          {error}
        </Banner>
      ) : null}

      <label className="nx-stack">
        <span>Format</span>
        <select
          data-testid="export-format"
          value={format}
          onChange={(event) => setFormat(event.target.value as ExportFormat)}
        >
          {EXPORT_FORMATS.map((value) => (
            <option key={value} value={value}>
              {EXPORT_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      {format === 'report' ? (
        <label className="nx-stack">
          <span>Summary (optional)</span>
          <textarea
            data-testid="export-summary"
            rows={3}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
      ) : null}
    </Dialog>
  );
}
