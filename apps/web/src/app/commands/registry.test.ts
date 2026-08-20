import { describe, expect, it, vi } from 'vitest';

import {
  CommandRegistry,
  readRecents,
  recordRecentCommand,
  type CommandContext,
} from './registry.ts';

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  role: 'owner',
  view: 'shell',
  projectId: null,
  boardId: null,
  navigate: vi.fn(),
  ...over,
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('CommandRegistry', () => {
  it('lists every registered command that has no when(), or whose when() passes', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'a', title: 'Always', group: 'help', run: () => undefined });
    registry.register({
      id: 'b',
      title: 'Board only',
      group: 'board',
      when: (c) => c.view === 'board',
      run: () => undefined,
    });

    expect(registry.available(ctx({ view: 'shell' })).map((c) => c.id)).toEqual(['a']);
    expect(registry.available(ctx({ view: 'board' })).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('gates a command by role via when(ctx)', () => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'delete',
      title: 'Delete board',
      group: 'board',
      when: (c) => c.role !== 'viewer',
      run: () => undefined,
    });
    expect(registry.available(ctx({ role: 'viewer' }))).toHaveLength(0);
    expect(registry.available(ctx({ role: 'owner' }))).toHaveLength(1);
  });

  it('fuzzy-searches by title, prefix and (4+ char terms) one edit away', () => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'new-project',
      title: 'New project',
      group: 'project',
      run: () => undefined,
    });
    registry.register({
      id: 'new-board',
      title: 'New board',
      group: 'board',
      run: () => undefined,
    });

    expect(registry.search('project', ctx()).map((c) => c.id)).toEqual(['new-project']);
    expect(registry.search('proj', ctx()).map((c) => c.id)).toEqual(['new-project']);
    expect(registry.search('projact', ctx()).map((c) => c.id)).toEqual(['new-project']);
  });

  it('excludes results gated out by when(), even when they would otherwise match', () => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'delete',
      title: 'Delete board',
      group: 'board',
      when: (c) => c.role !== 'viewer',
      run: () => undefined,
    });
    expect(registry.search('delete', ctx({ role: 'viewer' }))).toHaveLength(0);
  });

  it('an empty query returns every available command, unregistered order stable by title', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'b', title: 'Bravo', group: 'help', run: () => undefined });
    registry.register({ id: 'a', title: 'Alpha', group: 'help', run: () => undefined });
    expect(registry.search('', ctx()).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('ranks recent commands first on an empty query', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'a', title: 'Alpha', group: 'help', run: () => undefined });
    registry.register({ id: 'b', title: 'Bravo', group: 'help', run: () => undefined });
    const storage = memoryStorage();
    recordRecentCommand('b', storage);

    expect(registry.search('', ctx(), storage).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('never surfaces a recent command that is no longer available in this context', () => {
    const registry = new CommandRegistry();
    registry.register({
      id: 'board-only',
      title: 'Board only',
      group: 'board',
      when: (c) => c.view === 'board',
      run: () => undefined,
    });
    const storage = memoryStorage();
    recordRecentCommand('board-only', storage);
    expect(registry.search('', ctx({ view: 'shell' }), storage)).toHaveLength(0);
  });

  it('unregister removes a command from listing and search', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'a', title: 'Alpha', group: 'help', run: () => undefined });
    registry.unregister('a');
    expect(registry.available(ctx())).toHaveLength(0);
  });
});

describe('recordRecentCommand / readRecents', () => {
  it('keeps the most recent id first, deduplicated, capped at 5', () => {
    const storage = memoryStorage();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) recordRecentCommand(id, storage);
    recordRecentCommand('b', storage);
    expect(readRecents(storage)).toEqual(['b', 'f', 'e', 'd', 'c']);
  });

  it('degrades to an empty list instead of throwing when storage is unusable', () => {
    const broken: Storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    };
    expect(() => recordRecentCommand('a', broken)).not.toThrow();
    expect(readRecents(broken)).toEqual([]);
  });
});
