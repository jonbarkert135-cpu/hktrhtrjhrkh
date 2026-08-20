import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useProjects,
  useRenameProject,
  useWorkspace,
  useWorkspaceRole,
} from '../../data/workspace/context';
import { ensureLocalWorkspace } from '../../data/workspace/bootstrap';
import { capabilities } from '../../mode/appMode';
import { workspaceErrorMessage } from '../../data/workspace/errors';
import { canMutate } from '../../projects/BoardGrid';
import { CreateDialog } from './CreateDialog';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { Shell, type ShellProject } from './Shell';

/**
 * Local mode has no sign-up, so a first-run device would otherwise sit on a board while the rail
 * asks it to create its first project. One project is seeded instead, adopting the scratch board.
 */
function useLocalBootstrap(projects: readonly unknown[] | undefined): void {
  const repository = useWorkspace();
  const client = useQueryClient();
  const started = useRef(false);

  useEffect(() => {
    if (capabilities.auth) return;
    if (projects === undefined || projects.length > 0) return;
    if (started.current) return;
    started.current = true;
    // A seeding failure (private browsing, no quota) must not break the app: the user can still
    // work on the scratch board and the rail keeps offering "Create your first project".
    void ensureLocalWorkspace(repository)
      .then(async (created) => {
        if (created !== null)
          await client.invalidateQueries({ queryKey: ['workspace', 'projects'] });
      })
      .catch(() => undefined);
  }, [projects, repository, client]);
}

/**
 * The shell with data: the project rail is the app's only always-visible list, so it owns the
 * project query and the "New project" dialog, plus rename/archive/delete (P7 §2). `Shell` itself
 * stays presentational so the visual tests can render every state without a server.
 *
 * It reads through the workspace repository, so the same component serves IndexedDB in local mode
 * and the API in server mode.
 */
export function ShellContainer({
  children,
  boardTitle,
}: {
  children: ReactNode;
  boardTitle?: string | undefined;
}) {
  const navigate = useNavigate();
  const role = useWorkspaceRole();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<ShellProject | null>(null);
  const [deleting, setDeleting] = useState<ShellProject | null>(null);

  const projects = useProjects();
  useLocalBootstrap(projects.data);
  const create = useCreateProject(async (project) => {
    setOpen(false);
    await navigate(`/p/${project.id}`);
  });
  const rename = useRenameProject();
  const archive = useArchiveProject();
  const del = useDeleteProject();

  return (
    <>
      <Shell
        loading={projects.isPending}
        {...(projects.error ? { error: workspaceErrorMessage(projects.error) } : {})}
        onRetry={() => void projects.refetch()}
        {...(projects.data ? { projects: projects.data } : {})}
        {...(boardTitle === undefined ? {} : { boardTitle })}
        onCreateProject={() => setOpen(true)}
        canMutateProjects={canMutate(role)}
        onRenameProject={(project) => setRenaming(project)}
        onArchiveProject={(project) => archive.mutate({ projectId: project.id })}
        onDeleteProject={(project) => setDeleting(project)}
      >
        {children}
      </Shell>
      <CreateDialog
        open={open}
        onOpenChange={setOpen}
        title="New project"
        description="A project holds the boards, runs and files of one investigation."
        submitting={create.isPending}
        {...(create.error ? { error: workspaceErrorMessage(create.error) } : {})}
        onSubmit={(name) => create.mutate({ name })}
      />
      <CreateDialog
        open={renaming !== null}
        onOpenChange={(next) => {
          if (!next) setRenaming(null);
        }}
        title="Rename project"
        submitLabel="Rename"
        initialValue={renaming?.name ?? ''}
        submitting={rename.isPending}
        {...(rename.error ? { error: workspaceErrorMessage(rename.error) } : {})}
        onSubmit={(name) => {
          if (renaming === null) return;
          rename.mutate({ projectId: renaming.id, name }, { onSuccess: () => setRenaming(null) });
        }}
      />
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        kind="project"
        name={deleting?.name ?? ''}
        submitting={del.isPending}
        {...(del.error ? { error: workspaceErrorMessage(del.error) } : {})}
        onConfirm={() => {
          if (deleting === null) return;
          del.mutate(
            { projectId: deleting.id, confirmName: deleting.name },
            { onSuccess: () => setDeleting(null) },
          );
        }}
      />
    </>
  );
}
