/**
 * Binary blobs live in OPFS under `/boards/<boardId>/<fileId>` (P3 §5.8); the document only holds
 * the metadata record. Browsers without OPFS fall back to an IndexedDB object store with a one-time
 * warning, so file capture keeps working everywhere.
 */

export interface BlobStore {
  readonly backend: 'opfs' | 'indexeddb' | 'memory';
  put(boardId: string, fileId: string, blob: Blob): Promise<void>;
  get(boardId: string, fileId: string): Promise<Blob | null>;
  remove(boardId: string, fileId: string): Promise<void>;
}

const BLOB_DB = 'raven-blobs';
const BLOB_STORE = 'files';

const keyOf = (boardId: string, fileId: string): string => `boards/${boardId}/${fileId}`;

interface DirectoryHandleLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<File>;
}

interface StorageWithDirectory {
  getDirectory?: () => Promise<DirectoryHandleLike>;
}

export function opfsAvailable(nav: Navigator | undefined = globalThis.navigator): boolean {
  const storage = nav?.storage as StorageWithDirectory | undefined;
  return typeof storage?.getDirectory === 'function';
}

function opfsStore(nav: Navigator): BlobStore {
  const root = async (boardId: string, create: boolean): Promise<DirectoryHandleLike> => {
    const storage = nav.storage as unknown as { getDirectory: () => Promise<DirectoryHandleLike> };
    const dir = await storage.getDirectory();
    const boards = await dir.getDirectoryHandle('boards', { create });
    return boards.getDirectoryHandle(boardId, { create });
  };

  return {
    backend: 'opfs',
    async put(boardId, fileId, blob) {
      const dir = await root(boardId, true);
      const handle = await dir.getFileHandle(fileId, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    },
    async get(boardId, fileId) {
      try {
        const dir = await root(boardId, false);
        const handle = await dir.getFileHandle(fileId);
        return await handle.getFile();
      } catch {
        return null;
      }
    },
    async remove(boardId, fileId) {
      try {
        const dir = await root(boardId, false);
        await dir.removeEntry(fileId);
      } catch {
        // Removing a blob that is already gone is success, not an error.
      }
    },
  };
}

function openBlobDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(BLOB_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'));
  });
}

interface StoredBlob {
  type: string;
  bytes: ArrayBuffer;
}

/** Blobs are stored as bytes, not as `Blob` objects: structured-clone support for Blob is uneven. */
function blobToBytes(blob: Blob): Promise<ArrayBuffer> {
  const withArrayBuffer = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof withArrayBuffer.arrayBuffer === 'function') return withArrayBuffer.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsArrayBuffer(blob);
  });
}

function isStoredBlob(value: unknown): value is StoredBlob {
  if (typeof value !== 'object' || value === null || !('bytes' in value)) return false;
  const bytes: unknown = value.bytes;
  // `instanceof` is unreliable across realms (structured clone), so check the shape instead.
  return (
    typeof bytes === 'object' &&
    bytes !== null &&
    typeof (bytes as ArrayBuffer).byteLength === 'number'
  );
}

function idbStore(factory: IDBFactory): BlobStore {
  const run = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await openBlobDb(factory);
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(BLOB_STORE, mode).objectStore(BLOB_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'));
      });
    } finally {
      db.close();
    }
  };

  return {
    backend: 'indexeddb',
    async put(boardId, fileId, blob) {
      const record: StoredBlob = { type: blob.type, bytes: await blobToBytes(blob) };
      await run('readwrite', (store) => store.put(record, keyOf(boardId, fileId)));
    },
    async get(boardId, fileId) {
      const value = await run<unknown>('readonly', (store) => store.get(keyOf(boardId, fileId)));
      if (value instanceof Blob) return value;
      return isStoredBlob(value) ? new Blob([value.bytes], { type: value.type }) : null;
    },
    async remove(boardId, fileId) {
      await run('readwrite', (store) => store.delete(keyOf(boardId, fileId)));
    },
  };
}

function memoryStore(): BlobStore {
  const blobs = new Map<string, Blob>();
  return {
    backend: 'memory',
    put: (boardId, fileId, blob) => {
      blobs.set(keyOf(boardId, fileId), blob);
      return Promise.resolve();
    },
    get: (boardId, fileId) => Promise.resolve(blobs.get(keyOf(boardId, fileId)) ?? null),
    remove: (boardId, fileId) => {
      blobs.delete(keyOf(boardId, fileId));
      return Promise.resolve();
    },
  };
}

export interface BlobStoreEnv {
  navigator?: Navigator | undefined;
  indexedDB?: IDBFactory | undefined;
  /** Called once when OPFS is missing, so the UI can show the degraded-storage warning. */
  onFallback?: (backend: 'indexeddb' | 'memory') => void;
}

/** Picks the best available backend: OPFS → IndexedDB → memory (with a warning for the last two). */
export function createBlobStore(env: BlobStoreEnv = {}): BlobStore {
  const nav = env.navigator ?? globalThis.navigator;
  if (nav !== undefined && opfsAvailable(nav)) return opfsStore(nav);
  const factory = env.indexedDB ?? globalThis.indexedDB;
  if (factory !== undefined) {
    env.onFallback?.('indexeddb');
    return idbStore(factory);
  }
  env.onFallback?.('memory');
  return memoryStore();
}
