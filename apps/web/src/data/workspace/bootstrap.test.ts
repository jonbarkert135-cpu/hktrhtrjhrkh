import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BOARD_TITLE, SCRATCH_BOARD_ID, ensureLocalWorkspace } from './bootstrap.ts';
import { fakeBoard, fakeProject, fakeWorkspaceRepository } from './testFakes.ts';
import type { WorkspaceProject, WorkspaceRepository } from './types.ts';

const project: WorkspaceProject = fakeProject({ id: 'p1', name: 'My research' });
const board = fakeBoard({ id: SCRATCH_BOARD_ID, projectId: 'p1', title: DEFAULT_BOARD_TITLE });

const repository = (projects: WorkspaceProject[]): WorkspaceRepository =>
  fakeWorkspaceRepository({
    listProjects: vi.fn(() => Promise.resolve(projects)),
    createProject: vi.fn(() => Promise.resolve(project)),
    listBoards: vi.fn(() => Promise.resolve([])),
    createBoard: vi.fn(() => Promise.resolve(board)),
  });

describe('ensureLocalWorkspace', () => {
  it('seeds one project holding the scratch board on a fresh device', async () => {
    const repo = repository([]);
    await expect(ensureLocalWorkspace(repo)).resolves.toEqual(project);
    expect(repo.createProject).toHaveBeenCalledWith({ name: 'My research' });
    expect(repo.createBoard).toHaveBeenCalledWith({
      projectId: 'p1',
      title: DEFAULT_BOARD_TITLE,
      id: SCRATCH_BOARD_ID,
    });
  });

  it('does nothing when the device already has a project', async () => {
    const repo = repository([project]);
    await expect(ensureLocalWorkspace(repo)).resolves.toBeNull();
    expect(repo.createProject).not.toHaveBeenCalled();
    expect(repo.createBoard).not.toHaveBeenCalled();
  });
});
