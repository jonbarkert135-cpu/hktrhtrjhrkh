import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { createLocalWorkspaceRepository } from './local';
import { WorkspaceError } from './types';

let factory: IDBFactory;

const repo = (now?: () => string) =>
  createLocalWorkspaceRepository({ factory, ...(now ? { now } : {}) });

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // A fresh database per test: these assertions are about persistence, so leakage between them
  // would make a broken write look like a passing read.
  factory = new IDBFactory();
});

describe('local workspace repository', () => {
  it('starts empty — a first run has no projects and no error', async () => {
    await expect(repo().listProjects()).resolves.toEqual([]);
  });

  it('creates a project and returns it from a later, independent read', async () => {
    const created = await repo().createProject({ name: 'Atlas' });
    expect(created.id).toMatch(/^[a-z][a-z0-9]{23}$/);

    // A second repository instance = a second page load against the same device storage.
    const listed = await repo().listProjects();
    expect(listed).toEqual([created]);
  });

  it('keeps the data across a simulated restart of the whole stack', async () => {
    await repo().createProject({ name: 'Atlas' });
    const projects = await repo().listProjects();
    const project = projects[0];
    expect(project).toBeDefined();
    await repo().createBoard({ projectId: project?.id ?? '', title: 'Timeline' });

    const reopened = createLocalWorkspaceRepository({ factory });
    const boards = await reopened.listBoards(project?.id ?? '');
    expect(boards.map((b) => b.title)).toEqual(['Timeline']);
  });

  it('orders both lists oldest first, so the rail does not reshuffle between reads', async () => {
    let clock = 0;
    const r = repo(() => new Date(1_700_000_000_000 + clock++ * 1000).toISOString());
    await r.createProject({ name: 'first' });
    await r.createProject({ name: 'second' });
    await r.createProject({ name: 'third' });
    expect((await r.listProjects()).map((p) => p.name)).toEqual(['first', 'second', 'third']);
  });

  it('scopes boards to their project', async () => {
    const r = repo();
    const a = await r.createProject({ name: 'A' });
    const b = await r.createProject({ name: 'B' });
    await r.createBoard({ projectId: a.id, title: 'a-board' });
    await r.createBoard({ projectId: b.id, title: 'b-board' });
    expect((await r.listBoards(a.id)).map((x) => x.title)).toEqual(['a-board']);
    expect((await r.listBoards(b.id)).map((x) => x.title)).toEqual(['b-board']);
  });

  it('trims names and refuses an empty one with copy, not a crash', async () => {
    const r = repo();
    expect((await r.createProject({ name: '  Atlas  ' })).name).toBe('Atlas');
    await expect(r.createProject({ name: '   ' })).rejects.toThrow(WorkspaceError);
    await expect(r.createBoard({ projectId: 'p', title: '' })).rejects.toThrow(
      /Give the board a title/,
    );
  });

  it('reports an unusable browser instead of failing silently', async () => {
    // Private browsing in some engines: the global exists as `undefined`.
    vi.stubGlobal('indexedDB', undefined);
    const withoutIdb = createLocalWorkspaceRepository({});
    await expect(withoutIdb.listProjects()).rejects.toThrow(/Local storage is unavailable/);
  });

  it('identifies itself as the local implementation', () => {
    expect(repo().kind).toBe('local');
  });
});
