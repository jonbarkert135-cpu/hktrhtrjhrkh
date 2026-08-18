/**
 * The upload queue (P4 §5.9, 09_BACKEND.md §7.1).
 *
 * Contract, in the order the states occur:
 *   queued → hashing → uploading → completing → done
 *                 ↘ cancelled            ↘ failed (retryable)
 *
 * Rules that are load-bearing:
 *   - at most `concurrency` (4) files are in flight; the rest wait in order;
 *   - the SHA-256 is computed from the same chunks that are sent, never by re-reading the file;
 *   - a failed task keeps its place and its data so the node on the canvas can offer "Retry";
 *   - cancel is immediate and never leaves a task in a running state.
 */
import { Sha256, UPLOAD_CONCURRENCY, validateUpload } from '@nexus/domain';

export type UploadStatus =
  | 'queued'
  | 'hashing'
  | 'uploading'
  | 'completing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface UploadTask {
  /** Client-side id; the server file id appears in `fileId` once presigned. */
  id: string;
  filename: string;
  bytes: number;
  mime: string;
  status: UploadStatus;
  /** 0…1 over the bytes sent. */
  progress: number;
  fileId: string | null;
  sha256: string | null;
  /** Set in `failed`; already phrased for the user. */
  error: string | null;
  attempts: number;
}

export interface PresignSingle {
  mode: 'single';
  fileId: string;
  url: string;
}

export interface PresignExisting {
  mode: 'existing';
  fileId: string;
}

export interface UploadApi {
  presign: (input: {
    projectId: string;
    boardId?: string | undefined;
    filename: string;
    declaredMime: string;
    bytes: number;
    sha256?: string | undefined;
  }) => Promise<PresignSingle | PresignExisting>;
  complete: (input: {
    fileId: string;
    sha256: string;
  }) => Promise<{ state: string; failure: { message: string } | null }>;
}

/** Sends the bytes to a presigned URL. Injected so tests never need XHR or a network. */
export type BlobPut = (input: {
  url: string;
  blob: Blob;
  contentType: string;
  onProgress: (sentBytes: number) => void;
  signal: AbortSignal;
}) => Promise<void>;

export interface UploadQueueOptions {
  api: UploadApi;
  put: BlobPut;
  projectId: string;
  boardId?: string | undefined;
  concurrency?: number;
  maxAttempts?: number;
  /** Backoff before attempt n (1-based); overridden in tests to keep them instant. */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  chunkBytes?: number;
}

export interface UploadQueue {
  /** Enqueue a file. Returns the task id, even when the file is rejected up front. */
  add: (file: File) => string;
  cancel: (taskId: string) => void;
  /** Re-queue a failed task with a fresh presign. No-op for anything not failed. */
  retry: (taskId: string) => void;
  tasks: () => UploadTask[];
  subscribe: (listener: () => void) => () => void;
  /** Resolves once nothing is queued or running. */
  idle: () => Promise<void>;
}

const defaultBackoff = (attempt: number): number => Math.min(30_000, 500 * 2 ** (attempt - 1));

/**
 * Bytes of a blob slice. Browsers implement `Blob.arrayBuffer()`, but jsdom's `slice()` returns a
 * blob without it, so the FileReader path keeps the hashing loop testable in the unit environment.
 */
export const readBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsArrayBuffer(blob);
  });
};

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== ''
    ? error.message
    : 'Upload failed. Check your connection and retry.';

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const {
    api,
    put,
    projectId,
    boardId,
    concurrency = UPLOAD_CONCURRENCY,
    maxAttempts = 3,
    backoffMs = defaultBackoff,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    chunkBytes = 4 * 1024 * 1024,
  } = options;

  const order: string[] = [];
  const tasks = new Map<string, UploadTask>();
  const files = new Map<string, File>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const idleWaiters: (() => void)[] = [];
  let running = 0;
  let nextId = 0;

  // `tasks()` is a `useSyncExternalStore` snapshot: it must be referentially stable between
  // changes, or React re-renders forever.
  let snapshot: UploadTask[] | null = null;

  const emit = (): void => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

  const patch = (id: string, changes: Partial<UploadTask>): void => {
    const task = tasks.get(id);
    if (task === undefined) return;
    tasks.set(id, { ...task, ...changes });
    emit();
  };

  const settleIdle = (): void => {
    if (running > 0 || order.some((id) => tasks.get(id)?.status === 'queued')) return;
    while (idleWaiters.length > 0) idleWaiters.pop()?.();
  };

  /** Hash the file in slices (never fully in memory), then send it and report progress. */
  async function transfer(
    id: string,
    url: string,
    file: File,
    signal: AbortSignal,
  ): Promise<string> {
    const hash = new Sha256();
    for (let start = 0; start < file.size; start += chunkBytes) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const slice = file.slice(start, Math.min(start + chunkBytes, file.size));
      hash.update(await readBytes(slice));
    }
    const digest = hash.hex();
    patch(id, { status: 'uploading', sha256: digest });
    await put({
      url,
      blob: file,
      contentType: file.type,
      onProgress: (bytes) => patch(id, { progress: file.size === 0 ? 1 : bytes / file.size }),
      signal,
    });
    return digest;
  }

  async function run(id: string): Promise<void> {
    const file = files.get(id);
    const task = tasks.get(id);
    if (file === undefined || task === undefined || task.status === 'cancelled') return;

    const controller = new AbortController();
    controllers.set(id, controller);
    running += 1;
    try {
      for (let attempt = task.attempts + 1; attempt <= maxAttempts; attempt += 1) {
        patch(id, { status: 'hashing', attempts: attempt, error: null });
        try {
          const presigned = await api.presign({
            projectId,
            boardId,
            filename: file.name,
            declaredMime: file.type || 'application/octet-stream',
            bytes: file.size,
          });
          if (presigned.mode === 'existing') {
            patch(id, { status: 'done', progress: 1, fileId: presigned.fileId });
            return;
          }
          patch(id, { fileId: presigned.fileId });
          const sha256 = await transfer(id, presigned.url, file, controller.signal);

          patch(id, { status: 'completing', sha256, progress: 1 });
          const result = await api.complete({ fileId: presigned.fileId, sha256 });
          if (result.state !== 'ready') {
            // A server-side rejection (wrong type, size mismatch) is final: retrying the same
            // bytes cannot change the verdict.
            patch(id, {
              status: 'failed',
              error: result.failure?.message ?? 'The server rejected this file.',
            });
            return;
          }
          patch(id, { status: 'done', progress: 1 });
          return;
        } catch (error) {
          if (controller.signal.aborted) {
            patch(id, { status: 'cancelled', error: null });
            return;
          }
          const last = attempt >= maxAttempts;
          patch(id, {
            status: last ? 'failed' : 'queued',
            error: last ? messageOf(error) : null,
            progress: 0,
          });
          if (last) return;
          await sleep(backoffMs(attempt));
        }
      }
    } finally {
      controllers.delete(id);
      running -= 1;
      pump();
      settleIdle();
    }
  }

  function pump(): void {
    while (running < concurrency) {
      const next = order.find((id) => tasks.get(id)?.status === 'queued');
      if (next === undefined) return;
      // `run` flips the status synchronously on its first `patch`, so the same task is never
      // picked twice.
      patch(next, { status: 'hashing' });
      void run(next);
    }
  }

  return {
    add(file) {
      const id = `up_${(nextId += 1)}`;
      const declaredMime = file.type || 'application/octet-stream';
      const task: UploadTask = {
        id,
        filename: file.name,
        bytes: file.size,
        mime: declaredMime,
        status: 'queued',
        progress: 0,
        fileId: null,
        sha256: null,
        error: null,
        attempts: 0,
      };
      const rejection = validateUpload({ filename: file.name, declaredMime, bytes: file.size });
      order.push(id);
      files.set(id, file);
      tasks.set(
        id,
        rejection === null ? task : { ...task, status: 'failed', error: rejection.message },
      );
      emit();
      if (rejection === null) pump();
      return id;
    },

    cancel(id) {
      const task = tasks.get(id);
      if (task === undefined || task.status === 'done') return;
      controllers.get(id)?.abort();
      patch(id, { status: 'cancelled', error: null });
      settleIdle();
    },

    retry(id) {
      const task = tasks.get(id);
      if (task === undefined || (task.status !== 'failed' && task.status !== 'cancelled')) return;
      const file = files.get(id);
      if (file === undefined) return;
      const rejection = validateUpload({
        filename: file.name,
        declaredMime: task.mime,
        bytes: file.size,
      });
      if (rejection !== null) {
        patch(id, { status: 'failed', error: rejection.message });
        return;
      }
      patch(id, { status: 'queued', error: null, attempts: 0, progress: 0 });
      pump();
    },

    tasks: () => {
      snapshot ??= order
        .map((id) => tasks.get(id))
        .filter((task): task is UploadTask => task !== undefined);
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    idle() {
      if (running === 0 && !order.some((id) => tasks.get(id)?.status === 'queued')) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}

/** Browser `put` implementation: XHR, because `fetch` still cannot report upload progress. */
export const xhrPut: BlobPut = ({ url, blob, contentType, onProgress, signal }) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    if (contentType !== '') xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed with status ${xhr.status}. Retrying may help.`));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and retry.'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
