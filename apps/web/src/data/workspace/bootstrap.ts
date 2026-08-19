/**
 * First-run bootstrap for local mode.
 *
 * Local mode has no sign-up, so the app opens straight onto a board. Without this the project rail
 * would keep saying "Create your first project" while the user is already typing on a board — the
 * board at `/` is the scratch document, which until now existed in no project at all.
 *
 * The bootstrap adopts that scratch document instead of creating a second one: the default board is
 * written with the same id the root route opens, so nothing the user typed before is orphaned.
 * It is a no-op as soon as one project exists, so it runs exactly once per device.
 */

import type { WorkspaceProject, WorkspaceRepository } from './types.ts';

/** The board id the root route (`/`) opens; see app/pages/BoardPage.tsx. */
export const SCRATCH_BOARD_ID = 'scratch';

export const DEFAULT_PROJECT_NAME = 'My research';
export const DEFAULT_BOARD_TITLE = 'Untitled board';

/**
 * Ensures the device has one project holding the scratch board. Returns the project it created, or
 * `null` when the workspace already had one.
 */
export async function ensureLocalWorkspace(
  repository: WorkspaceRepository,
): Promise<WorkspaceProject | null> {
  const projects = await repository.listProjects();
  if (projects.length > 0) return null;

  const project = await repository.createProject({ name: DEFAULT_PROJECT_NAME });
  await repository.createBoard({
    projectId: project.id,
    title: DEFAULT_BOARD_TITLE,
    id: SCRATCH_BOARD_ID,
  });
  return project;
}
