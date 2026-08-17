import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage, trpc } from '../../lib/trpc';
import { CreateDialog } from './CreateDialog';
import { Shell } from './Shell';

/**
 * The shell with data: the project rail is the app's only always-visible list, so it owns the
 * `project.list` query and the "New project" dialog. `Shell` itself stays presentational so the
 * visual tests can render every state without a server.
 */
export function ShellContainer({
  children,
  boardTitle,
}: {
  children: ReactNode;
  boardTitle?: string | undefined;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  const projects = trpc.project.list.useQuery({});
  const create = trpc.project.create.useMutation({
    onSuccess: async (project) => {
      setOpen(false);
      await utils.project.list.invalidate();
      await navigate(`/p/${project.id}`);
    },
  });

  return (
    <>
      <Shell
        loading={projects.isPending}
        {...(projects.error ? { error: errorMessage(projects.error) } : {})}
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
        {...(create.error ? { error: errorMessage(create.error) } : {})}
        onSubmit={(name) => create.mutate({ name })}
      />
    </>
  );
}
