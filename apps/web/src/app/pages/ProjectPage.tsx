import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Banner, Button, Skeleton } from '@nexus/ui';
import { useBoards, useCreateBoard, useProjects } from '../../data/workspace/context';
import { workspaceErrorMessage } from '../../data/workspace/errors';
import { CreateDialog } from '../shell/CreateDialog';

/** Boards of one project, plus the only way to make a new one. */
export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const id = projectId ?? '';
  const projects = useProjects();
  const project = projects.data?.find((candidate) => candidate.id === id);
  const boards = useBoards(id);
  const create = useCreateBoard(id, async (board) => {
    setOpen(false);
    await navigate(`/b/${board.id}`);
  });

  if (projects.isPending || boards.isPending) {
    return (
      <section className="nx-stack" aria-busy="true" aria-label="Loading project">
        <Skeleton height="var(--nx-space-9)" />
        <Skeleton height="var(--nx-space-9)" />
      </section>
    );
  }

  if (projects.error || boards.error) {
    return (
      <Banner kind="danger" title="Couldn't load this project">
        {workspaceErrorMessage(projects.error ?? boards.error)}
      </Banner>
    );
  }

  if (!project) {
    return (
      <Banner kind="warn" title="That project no longer exists">
        It may have been deleted or moved. Pick another project from the rail.
      </Banner>
    );
  }

  const items = boards.data ?? [];

  return (
    <section className="nx-stack">
      <h2>{project.name}</h2>
      {items.length === 0 ? (
        <>
          <p className="nx-muted">
            A board is one canvas: notes, links and files you connect while you work.
          </p>
          <Button onClick={() => setOpen(true)}>Create your first board</Button>
        </>
      ) : (
        <>
          <ul className="nx-stack">
            {items.map((board) => (
              <li key={board.id}>
                <Link to={`/b/${board.id}`}>{board.title}</Link>
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => setOpen(true)}>
            New board
          </Button>
        </>
      )}
      <CreateDialog
        open={open}
        onOpenChange={setOpen}
        title="New board"
        description="Boards are where the canvas lives. You can rename it later."
        submitting={create.isPending}
        {...(create.error ? { error: workspaceErrorMessage(create.error) } : {})}
        onSubmit={(title) => create.mutate({ title })}
      />
    </section>
  );
}
