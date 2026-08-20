import { useMemo, useState } from 'react';
import { BUILTIN_TEMPLATES } from '@nexus/domain';
import { Banner, Button, Dialog, Field } from '@nexus/ui';
import type { WorkspaceBoard, WorkspaceRole } from '../data/workspace/types';
import { BoardCard, canMutate } from './BoardCard';

/** Cards rendered before the "Show more" affordance kicks in (P7 §10: virtualize above 60). */
const PAGE_SIZE = 60;

export function sortBoards(boards: readonly WorkspaceBoard[]): WorkspaceBoard[] {
  return [...boards].sort((a, b) => {
    const aTime = a.lastOpenedAt ?? a.createdAt;
    const bTime = b.lastOpenedAt ?? b.createdAt;
    return bTime.localeCompare(aTime);
  });
}

export function BoardGrid({
  boards,
  role,
}: {
  boards: readonly WorkspaceBoard[];
  role: WorkspaceRole;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [showTemplatesOnly, setShowTemplatesOnly] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const sorted = sortBoards(boards);
    return sorted.filter((board) => {
      if (!showArchived && board.archivedAt !== null) return false;
      if (showTemplatesOnly && !board.isTemplate) return false;
      return true;
    });
  }, [boards, showArchived, showTemplatesOnly]);

  const page = filtered.slice(0, visible);

  return (
    <div className="nx-stack">
      <div className="nx-toolbar" role="group" aria-label="Board filters">
        <label className="nx-checkbox">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived
        </label>
        <label className="nx-checkbox">
          <input
            type="checkbox"
            checked={showTemplatesOnly}
            onChange={(event) => setShowTemplatesOnly(event.target.checked)}
          />
          Templates only
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="nx-muted">No boards match these filters.</p>
      ) : (
        <>
          <ul className="nx-card-grid">
            {page.map((board) => (
              <BoardCard key={board.id} board={board} role={role} />
            ))}
          </ul>
          {filtered.length > page.length ? (
            <Button variant="secondary" onClick={() => setVisible((n) => n + PAGE_SIZE)}>
              Show more ({String(filtered.length - page.length)} more)
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface NewBoardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  error?: string | undefined;
  onSubmit: (input: { title: string; templateId?: string }) => void;
}

/** "Blank" plus the three built-in templates (P7 §5.4) — any future user-saved template joins the
 * same list once template browsing across projects ships; out of scope here (see BoardGrid). */
export function NewBoardDialog({
  open,
  onOpenChange,
  submitting,
  error,
  onSubmit,
}: NewBoardDialogProps) {
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setTitle('');
          setTemplateId(undefined);
        }
      }}
      title="New board"
      description="Boards are where the canvas lives. You can rename it later."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={submitting || title.trim() === ''}
            onClick={() => onSubmit({ title: title.trim(), ...(templateId ? { templateId } : {}) })}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="nx-stack">
        {error ? (
          <Banner kind="danger" title="Couldn't create that board">
            {error}
          </Banner>
        ) : null}
        <Field
          label="Name"
          name="title"
          autoComplete="off"
          value={title}
          disabled={submitting}
          onChange={(event) => setTitle(event.target.value)}
        />
        <fieldset className="nx-stack">
          <legend>Start from</legend>
          <label className="nx-radio">
            <input
              type="radio"
              name="template"
              checked={templateId === undefined}
              onChange={() => setTemplateId(undefined)}
            />
            Blank board
          </label>
          {BUILTIN_TEMPLATES.map((template) => (
            <label className="nx-radio" key={template.id}>
              <input
                type="radio"
                name="template"
                checked={templateId === template.id}
                onChange={() => setTemplateId(template.id)}
              />
              {template.title} — <span className="nx-muted">{template.description}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}

export { canMutate };
