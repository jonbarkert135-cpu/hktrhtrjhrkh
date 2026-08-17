import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBlobStore, opfsAvailable } from './opfs';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

/** Minimal in-memory OPFS: directories are maps, files are blobs. */
function fakeOpfsNavigator(): Navigator {
  const files = new Map<string, Blob>();
  const dir = (prefix: string): unknown => ({
    getDirectoryHandle: (name: string) => Promise.resolve(dir(`${prefix}${name}/`)),
    getFileHandle: (name: string, options?: { create?: boolean }) => {
      const key = `${prefix}${name}`;
      if (!files.has(key) && options?.create !== true)
        return Promise.reject(new Error('not found'));
      return Promise.resolve({
        createWritable: () =>
          Promise.resolve({
            write: (data: Blob) => {
              files.set(key, data);
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
          }),
        getFile: () => {
          const blob = files.get(key);
          return blob === undefined
            ? Promise.reject(new Error('not found'))
            : Promise.resolve(blob);
        },
      });
    },
    removeEntry: (name: string) => {
      files.delete(`${prefix}${name}`);
      return Promise.resolve();
    },
  });
  return { storage: { getDirectory: () => Promise.resolve(dir('')) } } as unknown as Navigator;
}

const roundTrip = async (store: ReturnType<typeof createBlobStore>): Promise<void> => {
  const blob = new Blob(['evidence'], { type: 'text/plain' });
  await store.put('b_1', 'f_1', blob);
  // jsdom's Blob has no `text()`, so identity plus size is the round-trip assertion here.
  const read = await store.get('b_1', 'f_1');
  expect(read?.size).toBe(blob.size);
  expect(read?.type).toBe('text/plain');
  await store.remove('b_1', 'f_1');
  expect(await store.get('b_1', 'f_1')).toBeNull();
  await store.remove('b_1', 'f_1'); // removing twice is not an error
};

describe('blob store', () => {
  it('detects OPFS support', () => {
    expect(opfsAvailable(fakeOpfsNavigator())).toBe(true);
    expect(opfsAvailable({} as Navigator)).toBe(false);
    expect(opfsAvailable(undefined)).toBe(false);
  });

  it('stores blobs in OPFS when it is available', async () => {
    const store = createBlobStore({ navigator: fakeOpfsNavigator() });
    expect(store.backend).toBe('opfs');
    await roundTrip(store);
  });

  it('falls back to IndexedDB with a warning', async () => {
    const onFallback = vi.fn();
    const store = createBlobStore({ navigator: {} as Navigator, onFallback });
    expect(store.backend).toBe('indexeddb');
    expect(onFallback).toHaveBeenCalledWith('indexeddb');
    await roundTrip(store);
    expect(await store.get('b_1', 'missing')).toBeNull();
  });

  it('falls back to memory when there is no storage at all', async () => {
    const onFallback = vi.fn();
    const store = createBlobStore({
      navigator: {} as Navigator,
      indexedDB: undefined as unknown as IDBFactory,
      onFallback,
    });
    // `indexedDB` is defined in jsdom, so force the memory path explicitly.
    const original = globalThis.indexedDB;
    // @ts-expect-error — deliberately removing the global for this assertion.
    delete globalThis.indexedDB;
    const memory = createBlobStore({ navigator: {} as Navigator, onFallback });
    expect(memory.backend).toBe('memory');
    await roundTrip(memory);
    globalThis.indexedDB = original;
    expect(store.backend).toBe('indexeddb');
  });
});
