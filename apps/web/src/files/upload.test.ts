import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@nexus/domain';
import { createUploadQueue, type BlobPut, type UploadApi } from './upload.ts';

const file = (name: string, bytes: number, type = 'image/png'): File =>
  new File([new Uint8Array(bytes)], name, { type });

const setup = (
  over: {
    presign?: UploadApi['presign'];
    complete?: UploadApi['complete'];
    put?: BlobPut;
    concurrency?: number;
    maxAttempts?: number;
  } = {},
) => {
  const api: UploadApi = {
    presign:
      over.presign ??
      vi.fn(() => Promise.resolve({ mode: 'single' as const, fileId: 'f1', url: 'u' })),
    complete: over.complete ?? vi.fn(() => Promise.resolve({ state: 'ready', failure: null })),
  };
  const put: BlobPut =
    over.put ??
    vi.fn<BlobPut>(({ onProgress, blob }) => {
      onProgress(blob.size);
      return Promise.resolve();
    });
  const queue = createUploadQueue({
    api,
    put,
    projectId: 'p1',
    concurrency: over.concurrency ?? 4,
    maxAttempts: over.maxAttempts ?? 3,
    backoffMs: () => 0,
    sleep: () => Promise.resolve(),
    chunkBytes: 8,
  });
  return { api, put, queue };
};

describe('upload queue', () => {
  it('walks a file through hashing, upload and completion', async () => {
    const { queue, api } = setup();
    const id = queue.add(file('evidence.png', 24));
    await queue.idle();

    const task = queue.tasks().find((t) => t.id === id);
    expect(task).toMatchObject({ status: 'done', progress: 1, fileId: 'f1' });
    // The digest is computed from the bytes that were sent, not invented.
    expect(task?.sha256).toBe(sha256Hex(new Uint8Array(24)));
    expect(api.complete).toHaveBeenCalledWith({ fileId: 'f1', sha256: task?.sha256 });
  });

  it('reports progress as the bytes leave', async () => {
    const seen: number[] = [];
    const { queue } = setup({
      put: ({ onProgress, blob }) => {
        onProgress(blob.size / 2);
        onProgress(blob.size);
        return Promise.resolve();
      },
    });
    const id = queue.add(file('a.png', 100));
    queue.subscribe(() => {
      const progress = queue.tasks().find((t) => t.id === id)?.progress ?? 0;
      if (seen.at(-1) !== progress) seen.push(progress);
    });
    await queue.idle();
    expect(seen).toContain(0.5);
    expect(seen.at(-1)).toBe(1);
  });

  it('rejects an oversized file before any request is made', async () => {
    const { queue, api } = setup();
    queue.add(file('huge.png', 26 * 1024 * 1024));
    await queue.idle();
    expect(queue.tasks()[0]?.status).toBe('failed');
    expect(queue.tasks()[0]?.error).toMatch(/the limit is 25 MB/);
    expect(api.presign).not.toHaveBeenCalled();
  });

  it('skips the upload entirely when the org already has the blob', async () => {
    const put = vi.fn<BlobPut>();
    const { queue } = setup({
      presign: vi.fn(() => Promise.resolve({ mode: 'existing' as const, fileId: 'dedupe' })),
      put,
    });
    queue.add(file('again.png', 16));
    await queue.idle();
    expect(queue.tasks()[0]).toMatchObject({ status: 'done', fileId: 'dedupe', progress: 1 });
    expect(put).not.toHaveBeenCalled();
  });

  it('retries a transient network failure with backoff and then succeeds', async () => {
    const put = vi
      .fn<BlobPut>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(({ onProgress, blob }) => {
        onProgress(blob.size);
        return Promise.resolve();
      });
    const { queue } = setup({ put });
    queue.add(file('flaky.png', 16));
    await queue.idle();
    expect(put).toHaveBeenCalledTimes(2);
    expect(queue.tasks()[0]).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('gives up after maxAttempts and keeps the task with a retry-able message', async () => {
    const put = vi.fn<BlobPut>().mockRejectedValue(new Error('still down'));
    const { queue } = setup({ put, maxAttempts: 2 });
    queue.add(file('gone.png', 16));
    await queue.idle();
    expect(put).toHaveBeenCalledTimes(2);
    expect(queue.tasks()[0]).toMatchObject({ status: 'failed', error: 'still down' });
    expect(queue.tasks()).toHaveLength(1);
  });

  it('does not retry a server-side rejection — the same bytes cannot pass', async () => {
    const complete = vi.fn(() =>
      Promise.resolve({
        state: 'failed',
        failure: { message: 'The file is named like a image but its contents are text/html.' },
      }),
    );
    const { queue, put } = setup({ complete });
    queue.add(file('polyglot.png', 16));
    await queue.idle();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(queue.tasks()[0]).toMatchObject({ status: 'failed' });
    expect(queue.tasks()[0]?.error).toMatch(/text\/html/);
  });

  it('cancels an in-flight upload and leaves nothing running', async () => {
    let abortSignal: AbortSignal | undefined;
    const put: BlobPut = ({ signal }) =>
      new Promise((_resolve, reject) => {
        abortSignal = signal;
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
      });
    const { queue } = setup({ put });
    const id = queue.add(file('slow.png', 16));
    await vi.waitFor(() => expect(abortSignal).toBeDefined());

    queue.cancel(id);
    await queue.idle();
    expect(queue.tasks()[0]?.status).toBe('cancelled');
    expect(abortSignal?.aborted).toBe(true);
  });

  it('re-queues a failed task on retry() and can then succeed', async () => {
    const put = vi.fn<BlobPut>().mockRejectedValue(new Error('down'));
    const { queue } = setup({ put, maxAttempts: 1 });
    const id = queue.add(file('later.png', 16));
    await queue.idle();
    expect(queue.tasks()[0]?.status).toBe('failed');

    put.mockImplementation(({ onProgress, blob }) => {
      onProgress(blob.size);
      return Promise.resolve();
    });
    queue.retry(id);
    await queue.idle();
    expect(queue.tasks()[0]).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('ignores retry() for tasks that are not failed', async () => {
    const { queue } = setup();
    const id = queue.add(file('ok.png', 16));
    await queue.idle();
    queue.retry(id);
    queue.retry('nope');
    expect(queue.tasks()[0]?.status).toBe('done');
  });

  it('never runs more than the configured number of uploads at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const put: BlobPut = () =>
      new Promise<void>((resolve) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        release.push(() => {
          inFlight -= 1;
          resolve();
        });
      });
    const { queue } = setup({ put, concurrency: 4 });
    for (let i = 0; i < 9; i += 1) queue.add(file(`f${i}.png`, 16));

    await vi.waitFor(() => expect(release).toHaveLength(4));
    expect(peak).toBe(4);
    const done = queue.idle();
    for (let i = 0; i < 9; i += 1) {
      await vi.waitFor(() => expect(release.length).toBeGreaterThan(0));
      release.shift()?.();
    }
    await done;
    expect(peak).toBe(4);
    expect(queue.tasks().every((t) => t.status === 'done')).toBe(true);
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { queue } = setup();
    const listener = vi.fn();
    const unsubscribe = queue.subscribe(listener);
    queue.add(file('a.png', 16));
    await queue.idle();
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
    queue.add(file('b.png', 16));
    await queue.idle();
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});
