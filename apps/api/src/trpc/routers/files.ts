/**
 * `files` router — presign → direct-to-S3 upload → complete → sniff (09_BACKEND.md §3.5, §7).
 *
 * Two rules drive every branch here:
 *   - the client's declared MIME is a hint for size caps only; the sniffed type decides acceptance;
 *   - a rejected file leaves no bytes behind — the blob is deleted the moment the verdict is `failed`.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@nexus/db';
import {
  PRESIGN_TTL_SECONDS,
  SNIFF_WINDOW_BYTES,
  fileObjectKey,
  isSha256Hex,
  kindForMime,
  newId,
  uploadMode,
  validateUpload,
  verifySniffedType,
} from '@nexus/domain';
import { orgProcedure, router } from '../trpc.ts';
import { audit } from '../../audit.ts';
import { getStorage } from '../../files/storage.ts';
import { Id } from './project.ts';

interface FileRow {
  id: string;
  projectId: string;
  filename: string;
  mime: string;
  kind: string;
  bytes: bigint | number;
  sha256: string | null;
  state: string;
  failureCode: string | null;
  failureMessage: string | null;
  thumbKey: string | null;
  previewKey: string | null;
  pageCount: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const toDto = (f: FileRow) => ({
  id: f.id,
  projectId: f.projectId,
  filename: f.filename,
  bytes: Number(f.bytes),
  mime: f.mime,
  kind: f.kind,
  sha256: f.sha256,
  state: f.state,
  failure: f.failureCode === null ? null : { code: f.failureCode, message: f.failureMessage ?? '' },
  variants: { thumb: f.thumbKey, preview: f.previewKey, pageCount: f.pageCount },
  width: f.width,
  height: f.height,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});

async function assertProjectInOrg(projectId: string, orgId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That project no longer exists.' });
  }
}

/** A file is only reachable through the caller's own org, never by id alone. */
async function loadFile(fileId: string, orgId: string) {
  const file = await prisma.file.findFirst({ where: { id: fileId, orgId, deletedAt: null } });
  if (!file) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'That file no longer exists.' });
  }
  return file;
}

export const filesRouter = router({
  /**
   * Reserve a file id and hand back an upload URL. When the client already knows the content
   * hash and the org has that exact blob, no bytes move at all (content-addressed dedupe).
   */
  presign: orgProcedure('editor')
    .input(
      z.object({
        projectId: Id,
        boardId: Id.optional(),
        filename: z.string().min(1).max(255),
        declaredMime: z.string().max(255).default('application/octet-stream'),
        bytes: z.number().int().min(1).max(2_147_483_648),
        sha256: z.string().refine(isSha256Hex, 'Not a sha-256 digest').optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectInOrg(input.projectId, ctx.org.id);

      const rejection = validateUpload(input);
      if (rejection !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: rejection.message });
      }

      if (input.sha256 !== undefined) {
        const existing = await prisma.file.findFirst({
          where: { orgId: ctx.org.id, sha256: input.sha256, state: 'ready', deletedAt: null },
        });
        if (existing) {
          return { mode: 'existing' as const, fileId: existing.id, file: toDto(existing) };
        }
      }

      const fileId = newId.file();
      const storageKey = fileObjectKey({
        orgId: ctx.org.id,
        projectId: input.projectId,
        fileId,
        filename: input.filename,
      });
      await prisma.file.create({
        data: {
          id: fileId,
          orgId: ctx.org.id,
          projectId: input.projectId,
          boardId: input.boardId ?? null,
          filename: input.filename,
          mime: input.declaredMime,
          kind: kindForMime(input.declaredMime),
          bytes: BigInt(input.bytes),
          sha256: input.sha256 ?? null,
          storageKey,
          state: 'pending',
          createdBy: ctx.user.id,
        },
      });

      return {
        mode: 'single' as const,
        fileId,
        url: getStorage().presignPut(storageKey, PRESIGN_TTL_SECONDS),
        // ponytail: multipart (09_BACKEND.md §7.1 step 2) is not wired yet — a single PUT is valid
        // for every size we accept (S3 allows 5 GB, our hard cap is 2 GB), it is only less
        // resumable. `uploadMode` already reports which mode a size *should* use, so the client
        // and the tests are written against the final contract.
        recommendedMode: uploadMode(input.bytes),
        expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000),
      };
    }),

  /**
   * Called after the PUT succeeds: verify the stored byte count, sniff the real type, and either
   * promote the row to `ready` or fail it and delete the blob.
   */
  complete: orgProcedure('editor')
    .input(z.object({ fileId: Id, sha256: z.string().refine(isSha256Hex).optional() }))
    .mutation(async ({ ctx, input }) => {
      const file = await loadFile(input.fileId, ctx.org.id);
      if (file.state === 'ready') return toDto(file);

      const storage = getStorage();
      const stored = await storage.headBytes(file.storageKey);
      const fail = async (code: string, message: string) => {
        await storage.remove(file.storageKey);
        const updated = await prisma.file.update({
          where: { id: file.id },
          data: { state: 'failed', failureCode: code, failureMessage: message },
        });
        await audit(
          {
            action: 'file.rejected',
            outcome: 'error',
            actorId: ctx.user.id,
            orgId: ctx.org.id,
            targetKind: 'file',
            targetId: file.id,
            ip: ctx.ip,
            metadata: { code },
          },
          ctx.logger,
        );
        return toDto(updated);
      };

      if (stored === null) {
        return fail('FILE_MISSING', 'The upload never arrived. Try uploading the file again.');
      }
      if (stored !== Number(file.bytes)) {
        return fail(
          'FILE_SIZE_MISMATCH',
          `The upload is ${stored} bytes but ${Number(file.bytes)} were announced. Try again.`,
        );
      }

      const head = await storage.readHead(file.storageKey, SNIFF_WINDOW_BYTES);
      const verdict = verifySniffedType({ head, filename: file.filename });
      if (!verdict.ok) {
        return fail(verdict.code ?? 'FILE_TYPE_NOT_ALLOWED', verdict.message ?? 'File rejected.');
      }

      const updated = await prisma.file.update({
        where: { id: file.id },
        data: {
          state: 'ready',
          mime: verdict.mime,
          kind: verdict.kind,
          sha256: input.sha256 ?? file.sha256,
          failureCode: null,
          failureMessage: null,
        },
      });
      await audit(
        {
          action: 'file.uploaded',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'file',
          targetId: file.id,
          ip: ctx.ip,
          metadata: { kind: verdict.kind, bytes: Number(file.bytes) },
        },
        ctx.logger,
      );
      return toDto(updated);
    }),

  get: orgProcedure('viewer')
    .input(z.object({ fileId: Id }))
    .query(async ({ ctx, input }) => toDto(await loadFile(input.fileId, ctx.org.id))),

  list: orgProcedure('viewer')
    .input(
      z.object({
        projectId: Id,
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectInOrg(input.projectId, ctx.org.id);
      const files = await prisma.file.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
      return files.map(toDto);
    }),

  /** A short-lived presigned GET. Anything that is not an image or a pdf is served as a download. */
  download: orgProcedure('viewer')
    .input(
      z.object({
        fileId: Id,
        variant: z.enum(['original', 'thumb', 'preview']).default('original'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const file = await loadFile(input.fileId, ctx.org.id);
      if (file.state !== 'ready') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'That file is still being processed.',
        });
      }
      const key =
        input.variant === 'thumb'
          ? file.thumbKey
          : input.variant === 'preview'
            ? file.previewKey
            : file.storageKey;
      if (key === null) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'That preview has not been generated for this file.',
        });
      }
      const inline = file.kind === 'image' || file.kind === 'pdf' || input.variant !== 'original';
      return {
        url: getStorage().presignGet(key, PRESIGN_TTL_SECONDS, {
          filename: file.filename,
          attachment: !inline,
        }),
        expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000),
        filename: file.filename,
        bytes: Number(file.bytes),
      };
    }),

  /** Soft delete: the row is tombstoned now, the blob is collected by maintenance (§13.2). */
  delete: orgProcedure('editor')
    .input(z.object({ fileId: Id }))
    .mutation(async ({ ctx, input }) => {
      const file = await loadFile(input.fileId, ctx.org.id);
      await prisma.file.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
      await audit(
        {
          action: 'file.deleted',
          outcome: 'success',
          actorId: ctx.user.id,
          orgId: ctx.org.id,
          targetKind: 'file',
          targetId: file.id,
          ip: ctx.ip,
        },
        ctx.logger,
      );
      return { ok: true as const };
    }),
});
