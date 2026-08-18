import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateProject, useProjects } from '../../data/workspace/context';
import { workspaceErrorMessage } from '../../data/workspace/errors';
import { CreateDialog } from './CreateDialog';
import { Shell } from './Shell';

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
