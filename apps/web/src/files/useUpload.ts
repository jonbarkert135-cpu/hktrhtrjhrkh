/**
 * React binding for the upload queue: one queue per project, subscribed through
 * `useSyncExternalStore` so a progress tick re-renders the upload list and nothing else.
 */
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { trpc } from '../lib/trpc.tsx';
import {
  createUploadQueue,
  xhrPut,
  type BlobPut,
  type UploadApi,
  type UploadQueue,
  type UploadTask,
} from './upload.ts';

export interface UseUploadOptions {
  projectId: string;
  boardId?: string | undefined;
  /** Overridden in tests; production always uses the XHR implementation. */
  put?: BlobPut | undefined;
}

export interface UseUploadResult {
  tasks: UploadTask[];
  /** Enqueue files from a drop, a paste or a file picker. */
  upload: (files: readonly File[]) => string[];
  cancel: (taskId: string) => void;
  retry: (taskId: string) => void;
  /** True while at least one task is still moving. */
  busy: boolean;
}

const ACTIVE = new Set(['queued', 'hashing', 'uploading', 'completing']);

export function useUpload(options: UseUploadOptions): UseUploadResult {
  const utils = trpc.useUtils();
  const api = useMemo<UploadApi>(
    () => ({
      presign: (input) => utils.client.files.presign.mutate(input),
      complete: (input) => utils.client.files.complete.mutate(input),
    }),
    [utils],
  );

  const queueRef = useRef<UploadQueue | null>(null);
  const queue =
    queueRef.current ??
    (queueRef.current = createUploadQueue({
      api,
      put: options.put ?? xhrPut,
      projectId: options.projectId,
      boardId: options.boardId,
    }));

  const tasks = useSyncExternalStore(
    useCallback((listener: () => void) => queue.subscribe(listener), [queue]),
    () => queue.tasks(),
  );

  return {
    tasks,
    upload: useCallback((files) => files.map((file) => queue.add(file)), [queue]),
    cancel: useCallback((taskId: string) => queue.cancel(taskId), [queue]),
    retry: useCallback((taskId: string) => queue.retry(taskId), [queue]),
    busy: tasks.some((task) => ACTIVE.has(task.status)),
  };
}
