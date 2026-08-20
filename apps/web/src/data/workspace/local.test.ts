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

describe('project management', () => {
  it('renames, sets appearance, archives, restores and soft-deletes a project', async () => {
    const r = repo();
    const project = await r.createProject({ name: 'Atlas' });

    const renamed = await r.renameProject({ projectId: project.id, name: 'Atlas 2' });
    expect(renamed.name).toBe('Atlas 2');

    const styled = await r.setProjectAppearance({ projectId: project.id, color: '--project-blue' });
    expect(styled.color).toBe('--project-blue');
    expect(styled.icon).toBeNull();

    const archived = await r.archiveProject({ projectId: project.id });
    expect(archived.archivedAt).not.toBeNull();
    expect(await r.listProjects()).toEqual([]);
    expect((await r.listProjects({ includeArchived: true })).map((p) => p.id)).toEqual([
      project.id,
    ]);

    const restored = await r.restoreProject({ projectId: project.id });
    expect(restored.archivedAt).toBeNull();

    await expect(r.deleteProject({ projectId: project.id, confirmName: 'wrong' })).rejects.toThrow(
      /does not match/,
    );
    await expect(
      r.deleteProject({ projectId: project.id, confirmName: 'Atlas 2' }),
    ).resolves.toEqual({ ok: true });
    expect(await r.listProjects({ includeArchived: true })).toEqual([]);
  });

  it('reports "not found" for an operation on an unknown or already-deleted project', async () => {
    const r = repo();
    await expect(r.renameProject({ projectId: 'nope', name: 'x' })).rejects.toThrow(
      /no longer exists/,
    );
  });
});

describe('board management', () => {
  it('renames, moves, archives, restores and soft-deletes a board', async () => {
    const r = repo();
    const a = await r.createProject({ name: 'A' });
    const b = await r.createProject({ name: 'B' });
    const board = await r.createBoard({ projectId: a.id, title: 'Recon' });

    expect((await r.renameBoard({ boardId: board.id, title: 'Recon 2' })).title).toBe('Recon 2');

    const moved = await r.moveBoard({ boardId: board.id, projectId: b.id });
    expect(moved.projectId).toBe(b.id);
    expect(await r.listBoards(a.id)).toEqual([]);
    expect((await r.listBoards(b.id)).map((x) => x.id)).toEqual([board.id]);

    const archived = await r.archiveBoard({ boardId: board.id });
    expect(archived.archivedAt).not.toBeNull();
    expect(await r.listBoards(b.id)).toEqual([]);
    expect((await r.listBoards(b.id, { includeArchived: true })).map((x) => x.id)).toEqual([
      board.id,
    ]);

    expect((await r.restoreBoard({ boardId: board.id })).archivedAt).toBeNull();

    await expect(r.deleteBoard({ boardId: board.id })).resolves.toEqual({ ok: true });
    expect(await r.listBoards(b.id, { includeArchived: true })).toEqual([]);
  });

  it('creates a board from a template id, recorded as templateOf', async () => {
    const r = repo();
    const project = await r.createProject({ name: 'A' });
    const board = await r.createBoard({
      projectId: project.id,
      title: 'From template',
      templateId: 'investigation-starter',
    });
    expect(board.templateOf).toBe('investigation-starter');
    expect(board.isTemplate).toBe(false);
  });

  it('flags a board reusable as a template', async () => {
    const r = repo();
    const project = await r.createProject({ name: 'A' });
    const board = await r.createBoard({ projectId: project.id, title: 'Recon' });
    expect((await r.saveBoardAsTemplate({ boardId: board.id })).isTemplate).toBe(true);
  });

  it('records the last-opened time', async () => {
    let clock = 0;
    const now = () => new Date(1_700_000_000_000 + clock++ * 1000).toISOString();
    const r = repo(now);
    const project = await r.createProject({ name: 'A' });
    const board = await r.createBoard({ projectId: project.id, title: 'Recon' });
    expect(board.lastOpenedAt).toBeNull();

    await r.touchBoardOpened({ boardId: board.id });
    const [reopened] = await r.listBoards(project.id);
    expect(reopened?.lastOpenedAt).not.toBeNull();
  });

  it('clamps reported node/edge counts to non-negative integers', async () => {
    const r = repo();
    const project = await r.createProject({ name: 'A' });
    const board = await r.createBoard({ projectId: project.id, title: 'Recon' });

    await r.reportBoardCounts({ boardId: board.id, nodeCount: 12.6, edgeCount: -3 });
    const [updated] = await r.listBoards(project.id);
    expect(updated?.nodeCount).toBe(13);
    expect(updated?.edgeCount).toBe(0);
  });

  it('deep-copies a board: a new id, its own metadata, and the source Y.Doc content', async () => {
    const { createBoardDoc, addNodes, makeNode } = await import('@nexus/domain');
    const { IndexeddbPersistence } = await import('y-indexeddb');

    const r = repo();
    const project = await r.createProject({ name: 'A' });
    const source = await r.createBoard({ projectId: project.id, title: 'Original' });

    const doc = createBoardDoc({
      boardId: source.id,
      title: 'Original',
      now: '2026-01-01T00:00:00.000Z',
    });
    addNodes(
      doc,
      [
        makeNode(
          { id: 'n1', type: 'note', x: 0, y: 0, title: 'Hello' },
          '2026-01-01T00:00:00.000Z',
        ),
      ],
      { origin: 'local:create', now: '2026-01-01T00:00:00.000Z' },
    );
    const provider = new IndexeddbPersistence(`raven-board-${source.id}`, doc);
    await provider.whenSynced;
    await provider.destroy();

    const copy = await r.duplicateBoard({ boardId: source.id });
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe('Original copy');
    expect(copy.templateOf).toBe(source.id);

    const { listNodes } = await import('@nexus/domain');
    const Y = await import('yjs');
    const copyDoc = new Y.Doc();
    const copyProvider = new IndexeddbPersistence(`raven-board-${copy.id}`, copyDoc);
    await copyProvider.whenSynced;
    expect(listNodes(copyDoc).map((n) => n.title)).toEqual(['Hello']);
    await copyProvider.destroy();
  });
});
