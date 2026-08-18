import { describe, expect, it, vi } from 'vitest';

import type { BlobStore } from '../data/opfs.ts';
import { createLocalUploadTransport, localBlobUrl, parseLocalBlobUrl } from './localTransport';

function memoryBlobStore(): BlobStore & { size: () => number } {
  const map = new Map<string, Blob>();
  const key = (boardId: string, fileId: string) => `${boardId}/${fileId}`;
  return {
    backend: 'memory',
    put: (boardId, fileId, blob) => {
      map.set(key(boardId, fileId), blob);
      return Promise.resolve();
    },
    get: (boardId, fileId) => Promise.resolve(map.get(key(boardId, fileId)) ?? null),
    remove: (boardId, fileId) => {
      map.delete(key(boardId, fileId));
      return Promise.resolve();
    },
    size: () => map.size,
  };
}

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const blobOf = (bytes: Uint8Array, type: string): Blob => new Blob([bytes], { type });

const upload = async (
  transport: ReturnType<typeof createLocalUploadTransport>,
  input: { filename: string; mime: string; bytes: Uint8Array; announced?: number },
) => {
  const presigned = await transport.api.presign({
    projectId: 'p1',
    filename: input.filename,
    declaredMime: input.mime,
    bytes: input.announced ?? input.bytes.byteLength,
  });
  if (presigned.mode !== 'single') throw new Error('expected a single-part upload');
  await transport.put({
    url: presigned.url,
    blob: blobOf(input.bytes, input.mime),
    contentType: input.mime,
    onProgress: () => undefined,
    signal: new AbortController().signal,
  });
  return {
    fileId: presigned.fileId,
    result: await transport.api.complete({ fileId: presigned.fileId, sha256: 'x'.repeat(64) }),
  };
};

describe('local upload transport', () => {
  it('writes the bytes to this board and reports the file ready', async () => {
    const blobs = memoryBlobStore();
    const transport = createLocalUploadTransport({ blobs, boardId: 'b1' });
    const { fileId, result } = await upload(transport, {
      filename: 'shot.png',
      mime: 'image/png',
      bytes: PNG_HEADER,
    });
    expect(result.state).toBe('ready');
    await expect(blobs.get('b1', fileId)).resolves.not.toBeNull();
  });

  it('reports progress so the bar reaches 100% on a device write', async () => {
    const blobs = memoryBlobStore();
    const transport = createLocalUploadTransport({ blobs, boardId: 'b1' });
    const onProgress = vi.fn();
    const presigned = await transport.api.presign({
      projectId: 'p1',
      filename: 'shot.png',
      declaredMime: 'image/png',
      bytes: PNG_HEADER.byteLength,
    });
    if (presigned.mode !== 'single') throw new Error('expected a single-part upload');
    await transport.put({
      url: presigned.url,
      blob: blobOf(PNG_HEADER, 'image/png'),
      contentType: 'image/png',
      onProgress,
      signal: new AbortController().signal,
    });
    expect(onProgress).toHaveBeenCalledWith(PNG_HEADER.byteLength);
  });

  it('applies the same sniffing rule as the server: html wearing a .png name is rejected', async () => {
    const blobs = memoryBlobStore();
    const transport = createLocalUploadTransport({ blobs, boardId: 'b1' });
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>hi</body></html>');
    const { fileId, result } = await upload(transport, {
      filename: 'shot.png',
      mime: 'image/png',
      bytes: html,
    });
    expect(result.state).toBe('failed');
    expect(result.failure?.message).toMatch(/rejected|isn’t accepted|contents are/i);
    // The rejected bytes must not stay on the device.
    await expect(blobs.get('b1', fileId)).resolves.toBeNull();
  });

  it('fails a file whose stored size does not match what was announced', async () => {
    const blobs = memoryBlobStore();
    const transport = createLocalUploadTransport({ blobs, boardId: 'b1' });
    const { result } = await upload(transport, {
      filename: 'shot.png',
      mime: 'image/png',
      bytes: PNG_HEADER,
      announced: PNG_HEADER.byteLength + 10,
    });
    expect(result.state).toBe('failed');
    expect(result.failure?.message).toMatch(/changed while it was being saved/);
    expect(blobs.size()).toBe(0);
  });

  it('fails a completion for an upload nobody started', async () => {
    const transport = createLocalUploadTransport({ blobs: memoryBlobStore(), boardId: 'b1' });
    const result = await transport.api.complete({ fileId: 'unknown', sha256: 'x'.repeat(64) });
    expect(result.state).toBe('failed');
    expect(result.failure?.message).toMatch(/no longer in progress/);
  });

  it('reports a write that produced no file instead of claiming success', async () => {
    const blobs = memoryBlobStore();
    const transport = createLocalUploadTransport({ blobs, boardId: 'b1' });
    const presigned = await transport.api.presign({
      projectId: 'p1',
      filename: 'shot.png',
      declaredMime: 'image/png',
      bytes: 8,
    });
    // No `put` at all: the device write silently produced nothing.
    const result = await transport.api.complete({
      fileId: presigned.fileId,
      sha256: 'x'.repeat(64),
    });
    expect(result.state).toBe('failed');
    expect(result.failure?.message).toMatch(/could not be written to this device/);
  });

  it('leaves nothing behind when the upload is cancelled mid-write', async () => {
    const blobs = memoryBlobStore();
    const transport = createLocalUploadTransport({ blobs, boardId: 'b1' });
    const controller = new AbortController();
    const presigned = await transport.api.presign({
      projectId: 'p1',
      filename: 'shot.png',
      declaredMime: 'image/png',
      bytes: PNG_HEADER.byteLength,
    });
    if (presigned.mode !== 'single') throw new Error('expected a single-part upload');
    const put = transport.put({
      url: presigned.url,
      blob: blobOf(PNG_HEADER, 'image/png'),
      contentType: 'image/png',
      onProgress: () => undefined,
      signal: controller.signal,
    });
    controller.abort();
    await expect(put).rejects.toThrow(/Cancelled/);
    expect(blobs.size()).toBe(0);
  });

  it('refuses to send bytes anywhere but a local blob url', () => {
    expect(localBlobUrl('b1', 'f1')).toBe('local://b1/f1');
    expect(parseLocalBlobUrl('local://b1/f1')).toEqual({ boardId: 'b1', fileId: 'f1' });
    expect(() => parseLocalBlobUrl('https://evil.example/upload')).toThrow(/Not a local blob url/);
    expect(() => parseLocalBlobUrl('local://b1')).toThrow(/Not a local blob url/);
  });

  it('routes the bytes to the board the caller named, not the mounted one', async () => {
    const blobs = memoryBlobStore();
    const transport = createLocalUploadTransport({ blobs, boardId: 'default' });
    const presigned = await transport.api.presign({
      projectId: 'p1',
      boardId: 'other',
      filename: 'shot.png',
      declaredMime: 'image/png',
      bytes: PNG_HEADER.byteLength,
    });
    expect(presigned.mode === 'single' && presigned.url).toBe(
      localBlobUrl('other', presigned.fileId),
    );
  });
});
