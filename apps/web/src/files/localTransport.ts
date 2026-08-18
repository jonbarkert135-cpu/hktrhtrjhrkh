/**
 * The local-mode upload transport.
 *
 * The upload queue (`upload.ts`) was written against two seams — `UploadApi` and `BlobPut` — so the
 * whole "upload" story works with no server behind it: presigning becomes minting a local file id,
 * sending becomes a write into the OPFS blob store, completing becomes verifying the bytes that were
 * written. Everything the user sees (progress, cancel, retry, per-kind limits, the sniffing verdict)
 * is unchanged, because the queue itself is unchanged.
 *
 * The type check is the same `sniffType`/`verifySniffedType` the API runs: local mode is not a
 * relaxed mode. A file that would be rejected on the server is rejected here too, so a project
 * exported from a laptop cannot carry something a deployment would refuse.
 */
import { newId, SNIFF_WINDOW_BYTES, verifySniffedType } from '@nexus/domain';

import type { BlobStore } from '../data/opfs.ts';
import { readBytes } from './upload.ts';
import type { BlobPut, PresignExisting, PresignSingle, UploadApi } from './upload.ts';

/** `local://<boardId>/<fileId>` — parsed by `localPut`, never dereferenced by the network. */
const LOCAL_URL = 'local://';

export const localBlobUrl = (boardId: string, fileId: string): string =>
  `${LOCAL_URL}${boardId}/${fileId}`;

export function parseLocalBlobUrl(url: string): { boardId: string; fileId: string } {
  if (!url.startsWith(LOCAL_URL)) {
    throw new Error(`Not a local blob url: ${url}`);
  }
  const [boardId, fileId] = url.slice(LOCAL_URL.length).split('/');
  if (boardId === undefined || fileId === undefined || boardId === '' || fileId === '') {
    throw new Error(`Not a local blob url: ${url}`);
  }
  return { boardId, fileId };
}

export interface LocalUploadOptions {
  blobs: BlobStore;
  /** Which board's OPFS directory the bytes belong to. */
  boardId: string;
  /** Injected in tests. */
  newFileId?: (() => string) | undefined;
}

interface PendingLocalUpload {
  boardId: string;
  filename: string;
  bytes: number;
}

export interface LocalUploadTransport {
  api: UploadApi;
  put: BlobPut;
}

/**
 * Builds the `{ api, put }` pair the queue needs. They share a map of in-flight uploads, which is
 * how `complete` knows the declared type of the file whose bytes it is about to inspect.
 */
export function createLocalUploadTransport(options: LocalUploadOptions): LocalUploadTransport {
  const { blobs, boardId } = options;
  const newFileId = options.newFileId ?? (() => newId.file());
  const pending = new Map<string, PendingLocalUpload>();

  const api: UploadApi = {
    presign(input): Promise<PresignSingle | PresignExisting> {
      const fileId = newFileId();
      pending.set(fileId, {
        boardId: input.boardId ?? boardId,
        filename: input.filename,
        bytes: input.bytes,
      });
      return Promise.resolve({
        mode: 'single',
        fileId,
        url: localBlobUrl(input.boardId ?? boardId, fileId),
      });
    },

    async complete({ fileId }) {
      const record = pending.get(fileId);
      if (record === undefined) {
        return { state: 'failed', failure: { message: 'That upload is no longer in progress.' } };
      }
      pending.delete(fileId);

      const blob = await blobs.get(record.boardId, fileId);
      if (blob === null) {
        return {
          state: 'failed',
          failure: { message: 'The file could not be written to this device. Retry the upload.' },
        };
      }
      if (blob.size !== record.bytes) {
        await blobs.remove(record.boardId, fileId);
        return {
          state: 'failed',
          failure: { message: 'The file changed while it was being saved. Try adding it again.' },
        };
      }

      // `readBytes` rather than `arrayBuffer()`: a sliced blob has no `arrayBuffer` in jsdom, and
      // the queue already carries the FileReader fallback for exactly this reason.
      const head = await readBytes(blob.slice(0, SNIFF_WINDOW_BYTES));
      const verdict = verifySniffedType({ head, filename: record.filename });
      if (!verdict.ok) {
        // Same rule as the server: a file whose contents contradict its name never survives.
        await blobs.remove(record.boardId, fileId);
        return {
          state: 'failed',
          failure: { message: verdict.message ?? 'That file was rejected for safety.' },
        };
      }

      return { state: 'ready', failure: null };
    },
  };

  const put: BlobPut = async ({ url, blob, onProgress, signal }) => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const target = parseLocalBlobUrl(url);
    await blobs.put(target.boardId, target.fileId, blob);
    if (signal.aborted) {
      await blobs.remove(target.boardId, target.fileId);
      throw new DOMException('Cancelled', 'AbortError');
    }
    // A device write has no meaningful intermediate progress; the queue still needs the final tick
    // so the bar reaches 100% rather than freezing wherever it started.
    onProgress(blob.size);
  };

  return { api, put };
}
