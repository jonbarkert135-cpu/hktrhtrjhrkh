import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  projectsKey,
  useCreateProject,
  useProjects,
  useWorkspace,
} from '../../data/workspace/context';
import { ensureLocalWorkspace } from '../../data/workspace/bootstrap';
import { capabilities } from '../../mode/appMode';
import { workspaceErrorMessage } from '../../data/workspace/errors';
import { CreateDialog } from './CreateDialog';
import { Shell } from './Shell';

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
        if (created !== null) await client.invalidateQueries({ queryKey: projectsKey });
      })
      .catch(() => undefined);
  }, [projects, repository, client]);
}

/**
 * The shell with data: the project rail is the app's only always-visible list, so it owns the
 * project query and the "New project" dialog. `Shell` itself stays presentational so the visual
 * tests can render every state without a server.
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
  const [open, setOpen] = useState(false);

  const projects = useProjects();
  useLocalBootstrap(projects.data);
  const create = useCreateProject(async (project) => {
    setOpen(false);
    await navigate(`/p/${project.id}`);
  });

  return (
    <>
      <Shell
        loading={projects.isPending}
        {...(projects.error ? { error: workspaceErrorMessage(projects.error) } : {})}
        onRetry={() => void projects.refetch()}
        {...(projects.data ? { projects: projects.data } : {})}
        {...(boardTitle === undefined ? {} : { boardTitle })}
        onCreateProject={() => setOpen(true)}
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
    </>
  );
}
