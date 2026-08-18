/**
 * Import flow (P3 §6): file picker → validation → a summary of exactly what will be imported →
 * explicit confirm. A dropped file never imports silently.
 */

import { parseBoardExport, type BoardExportV1 } from '@nexus/domain';
import { Banner, Button, Dialog } from '@nexus/ui';
import { useState } from 'react';

export interface ImportPreview {
  data: BoardExportV1;
  migrations: string[];
}

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (preview: ImportPreview) => void;
}

export function readImportFile(text: string): ImportPreview {
  const { data, migrations } = parseBoardExport(JSON.parse(text));
  return { data, migrations };
}

export function ImportDialog({ open, onOpenChange, onConfirm }: ImportDialogProps) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    try {
      setPreview(readImportFile(await file.text()));
      setError(null);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'This file could not be read.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import a board"
      description="Nodes, edges, groups and notes from a .raven.json file are added to this board."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={preview === null}
            onClick={() => {
              if (preview !== null) onConfirm(preview);
            }}
          >
            Import
          </Button>
        </>
      }
    >
      {error !== null ? (
        <Banner kind="danger" title="This file was not imported">
          {error}
        </Banner>
      ) : null}

      <label className="nx-stack">
        <span>Board export file</span>
        <input
          type="file"
          accept="application/json,.json"
          data-testid="import-file"
          onChange={(event) => void pick(event.target.files?.[0])}
        />
      </label>

      {preview !== null ? (
        <div data-testid="import-summary" className="nx-stack">
          <p>
            <strong>{preview.data.board.title}</strong> — {String(preview.data.nodes.length)} nodes,{' '}
            {String(preview.data.edges.length)} edges, {String(preview.data.groups.length)} groups.
          </p>
          {preview.migrations.length > 0 ? (
            <Banner kind="info" title="This file uses an older format">
              It will be upgraded on import: {preview.migrations.join('; ')}
            </Banner>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
