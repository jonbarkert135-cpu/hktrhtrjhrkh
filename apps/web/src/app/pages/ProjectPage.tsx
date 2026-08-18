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
    <section className="nx-page">
      <header className="nx-page-head">
        <div>
          <h2 className="nx-page-title">{project.name}</h2>
          <p className="nx-page-sub">
            {items.length === 0
              ? 'No boards yet'
              : `${String(items.length)} ${items.length === 1 ? 'board' : 'boards'}`}
          </p>
        </div>
        {items.length > 0 ? <Button onClick={() => setOpen(true)}>New board</Button> : null}
      </header>

      {items.length === 0 ? (
        <div className="nx-empty">
          <div className="nx-empty-card">
            <h3 className="nx-empty-title">Start with a board</h3>
            <p className="nx-empty-body">
              A board is one canvas: notes, links and files you connect while you work. Everything
              stays on this device until you choose otherwise.
            </p>
            <Button onClick={() => setOpen(true)}>Create your first board</Button>
          </div>
        </div>
      ) : (
        <ul className="nx-card-grid">
          {items.map((board) => (
            <li key={board.id}>
              <Link className="nx-board-card" to={`/b/${board.id}`}>
                <span className="nx-board-card-title">{board.title}</span>
                {/* Decorative: the link's accessible name must stay the board title. */}
                <span className="nx-board-card-meta" aria-hidden="true">
                  Open canvas
                </span>
              </Link>
            </li>
          ))}
        </ul>
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
