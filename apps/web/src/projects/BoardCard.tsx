import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Button, Menu, MenuItem } from '@nexus/ui';
import type { WorkspaceBoard, WorkspaceRole } from '../data/workspace/types';
import {
  useArchiveBoard,
  useDeleteBoard,
  useDuplicateBoard,
  useRenameBoard,
  useRestoreBoard,
  useSaveBoardAsTemplate,
} from '../data/workspace/context';
import { workspaceErrorMessage } from '../data/workspace/errors';
import { CreateDialog } from '../app/shell/CreateDialog';
import { ConfirmDeleteDialog } from '../app/shell/ConfirmDeleteDialog';
import { useRegisterCommands } from '../app/commands/useRegisterCommands';
import type { Command } from '../app/commands/registry';

/** True once a viewer cannot mutate — every button below reads this, never a second copy. */
export function canMutate(role: WorkspaceRole): boolean {
  return role !== 'viewer';
}

/**
 * A deterministic placeholder in lieu of the worker-generated thumbnail (P7 §8/§11): no
 * `apps/worker` exists yet to render board snapshots, so a real thumbnail is out of scope this
 * phase. The placeholder is still *useful* (distinct per board, not a generic grey box) rather
 * than a stub — a small hashed gradient keyed on the board id.
 */
function placeholderStyle(boardId: string): CSSProperties {
  let hash = 0;
  for (const ch of boardId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${String(hue)} 45% 30%), hsl(${String((hue + 40) % 360)} 45% 18%))`,
  };
}

export function BoardCard({ board, role }: { board: WorkspaceBoard; role: WorkspaceRole }) {
  const mutable = canMutate(role);
  const disabledReason = mutable ? undefined : 'Viewers cannot change boards';

  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rename = useRenameBoard();
  const archive = useArchiveBoard();
  const restore = useRestoreBoard();
  const duplicate = useDuplicateBoard();
  const saveAsTemplate = useSaveBoardAsTemplate();
  const del = useDeleteBoard();

  const onRename = () => setRenaming(true);
  const onDuplicate = () => duplicate.mutate({ boardId: board.id });
  const onSaveAsTemplate = () => saveAsTemplate.mutate({ boardId: board.id });
  const onArchive = () => archive.mutate({ boardId: board.id });
  const onRestore = () => restore.mutate({ boardId: board.id });
  const onDelete = () => setDeleting(true);

  // Every menu action above registers the identical handler as a palette command (P7 §5.8): the
  // palette can never drift from the menu because both call the same closure.
  const commands: Command[] = mutable
    ? [
        {
          id: `board:${board.id}:rename`,
          title: `Rename board "${board.title}"`,
          group: 'board',
          keywords: ['rename', 'board', board.title],
          run: onRename,
        },
        {
          id: `board:${board.id}:duplicate`,
          title: `Duplicate board "${board.title}"`,
          group: 'board',
          keywords: ['duplicate', 'copy', 'board', board.title],
          run: onDuplicate,
        },
        {
          id: `board:${board.id}:save-as-template`,
          title: `Save "${board.title}" as a template`,
          group: 'board',
          keywords: ['template', 'save', 'board', board.title],
          run: onSaveAsTemplate,
        },
        board.archivedAt === null
          ? {
              id: `board:${board.id}:archive`,
              title: `Archive board "${board.title}"`,
              group: 'board',
              keywords: ['archive', 'board', board.title],
              run: onArchive,
            }
          : {
              id: `board:${board.id}:restore`,
              title: `Restore board "${board.title}"`,
              group: 'board',
              keywords: ['restore', 'unarchive', 'board', board.title],
              run: onRestore,
            },
        {
          id: `board:${board.id}:delete`,
          title: `Delete board "${board.title}"`,
          group: 'board',
          keywords: ['delete', 'remove', 'board', board.title],
          run: onDelete,
        },
      ]
    : [];
  useRegisterCommands(commands);

  return (
    <li>
      <div className="nx-board-card" data-archived={board.archivedAt !== null || undefined}>
        <Link
          className="nx-board-card-thumb"
          to={`/b/${board.id}`}
          style={placeholderStyle(board.id)}
        >
          <span className="nx-board-card-title">{board.title}</span>
          {board.isTemplate ? (
            <span className="nx-badge" aria-hidden="true">
              Template
            </span>
          ) : null}
        </Link>
        <div className="nx-board-card-meta">
          <span>
            {String(board.nodeCount)} {board.nodeCount === 1 ? 'node' : 'nodes'} ·{' '}
            {String(board.edgeCount)} {board.edgeCount === 1 ? 'link' : 'links'}
          </span>
          <span className="nx-muted">
            {board.lastOpenedAt === null
              ? 'Never opened'
              : `Opened ${new Date(board.lastOpenedAt).toLocaleDateString()}`}
          </span>
        </div>
        <Menu trigger={<Button variant="ghost">Actions</Button>} align="end">
          <MenuItem disabled={!mutable} onSelect={onRename}>
            Rename
          </MenuItem>
          <MenuItem disabled={!mutable} onSelect={onDuplicate}>
            Duplicate
          </MenuItem>
          <MenuItem disabled={!mutable} onSelect={onSaveAsTemplate}>
            Save as template
          </MenuItem>
          {board.archivedAt === null ? (
            <MenuItem disabled={!mutable} onSelect={onArchive}>
              Archive
            </MenuItem>
          ) : (
            <MenuItem disabled={!mutable} onSelect={onRestore}>
              Restore
            </MenuItem>
          )}
          <MenuItem kind="danger" disabled={!mutable} onSelect={onDelete}>
            Delete
          </MenuItem>
        </Menu>
        {disabledReason !== undefined ? (
          <span className="nx-muted" role="note">
            {disabledReason}
          </span>
        ) : null}
      </div>

      <CreateDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename board"
        submitLabel="Rename"
        initialValue={board.title}
        submitting={rename.isPending}
        {...(rename.error ? { error: workspaceErrorMessage(rename.error) } : {})}
        onSubmit={(title) => {
          rename.mutate({ boardId: board.id, title }, { onSuccess: () => setRenaming(false) });
        }}
      />
      <ConfirmDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        kind="board"
        name={board.title}
        submitting={del.isPending}
        {...(del.error ? { error: workspaceErrorMessage(del.error) } : {})}
        onConfirm={() => del.mutate({ boardId: board.id }, { onSuccess: () => setDeleting(false) })}
      />
    </li>
  );
}
