import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_ID, PROJECT_ID, ctx, prismaMock, recordAuditMock } from './prisma-mock.ts';

vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));

const storage = {
  presignPut: vi.fn(() => 'https://s3.example.com/put'),
  presignGet: vi.fn(() => 'https://s3.example.com/get'),
  headBytes: vi.fn(async () => 4 as number | null),
  readHead: vi.fn(async () => new Uint8Array()),
  remove: vi.fn(async () => undefined),
};
vi.mock('../src/files/storage.ts', () => ({ getStorage: () => storage }));

const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');
const caller = createCallerFactory(appRouter);

const FILE_ID = 'ffffffffffffffffffffffff';
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML_HEAD = new TextEncoder().encode('<!DOCTYPE html><html></html>');

const fileRow = (over: Record<string, unknown> = {}) => ({
  id: FILE_ID,
  orgId: ORG_ID,
  projectId: PROJECT_ID,
  filename: 'evidence.png',
  mime: 'image/png',
  kind: 'image',
  bytes: BigInt(8),
  sha256: null,
  storageKey: `org/${ORG_ID}/proj/${PROJECT_ID}/${FILE_ID}/evidence.png`,
  state: 'pending',
  failureCode: null,
  failureMessage: null,
  thumbKey: null,
  previewKey: null,
  pageCount: null,
  width: null,
  height: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
  storage.headBytes.mockResolvedValue(8);
  storage.readHead.mockResolvedValue(PNG_HEAD);
});

describe('files.presign', () => {
  const input = {
    projectId: PROJECT_ID,
    filename: 'evidence.png',
    declaredMime: 'image/png',
    bytes: 8,
  };

  it('creates a pending row with a server-generated key and returns an upload url', async () => {
    prismaMock.file.create.mockResolvedValue(fileRow());

    const result = await caller(ctx({ role: 'editor' })).files.presign(input);

    expect(result).toMatchObject({ mode: 'single', url: 'https://s3.example.com/put' });
    const created = prismaMock.file.create.mock.calls[0]?.[0]?.data;
    expect(created.state).toBe('pending');
    expect(created.orgId).toBe(ORG_ID);
    expect(created.storageKey).toBe(`org/${ORG_ID}/proj/${PROJECT_ID}/${created.id}/evidence.png`);
    expect(storage.presignPut).toHaveBeenCalledWith(created.storageKey, 900);
  });

  it('recommends multipart above 8 MB', async () => {
    prismaMock.file.create.mockResolvedValue(fileRow());
    const result = await caller(ctx({ role: 'editor' })).files.presign({
      ...input,
      bytes: 9 * 1024 * 1024,
    });
    expect(result).toMatchObject({ recommendedMode: 'multipart' });
  });

  it('short-circuits to the existing blob when the org already has that hash', async () => {
    const sha256 = 'a'.repeat(64);
    prismaMock.file.findFirst.mockResolvedValue(fileRow({ state: 'ready', sha256 }));

    const result = await caller(ctx({ role: 'editor' })).files.presign({ ...input, sha256 });

    expect(result).toMatchObject({ mode: 'existing', fileId: FILE_ID });
    expect(prismaMock.file.create).not.toHaveBeenCalled();
    expect(prismaMock.file.findFirst).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, sha256, state: 'ready', deletedAt: null },
    });
  });

  it('refuses an oversized file with the size, the limit and a way out', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).files.presign({ ...input, bytes: 142 * 1024 * 1024 }),
    ).rejects.toThrow(/the file is 142 MB, the limit is 25 MB/);
    expect(prismaMock.file.create).not.toHaveBeenCalled();
  });

  it('refuses a blocked extension', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).files.presign({ ...input, filename: 'payload.exe' }),
    ).rejects.toThrow(/\.exe files aren’t accepted/);
  });

  it('refuses a project from another org', async () => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    await expect(caller(ctx({ role: 'editor' })).files.presign(input)).rejects.toThrow(
      /no longer exists/i,
    );
  });

  it('is closed to viewers', async () => {
    await expect(caller(ctx({ role: 'viewer' })).files.presign(input)).rejects.toThrow(
      /don't have access/i,
    );
  });
});

describe('files.complete', () => {
  it('promotes the row to ready using the sniffed type and audits the upload', async () => {
    prismaMock.file.findFirst.mockResolvedValue(fileRow());
    prismaMock.file.update.mockImplementation(async ({ data }: { data: object }) =>
      fileRow({ ...data }),
    );

    const result = await caller(ctx({ role: 'editor' })).files.complete({ fileId: FILE_ID });

    expect(result).toMatchObject({ state: 'ready', mime: 'image/png', kind: 'image' });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.uploaded', targetId: FILE_ID }),
    );
  });

  it('fails the row and deletes the blob when the bytes are html wearing a .png name', async () => {
    prismaMock.file.findFirst.mockResolvedValue(fileRow());
    prismaMock.file.update.mockImplementation(async ({ data }: { data: object }) =>
      fileRow({ ...data }),
    );
    storage.readHead.mockResolvedValue(HTML_HEAD);

    const result = await caller(ctx({ role: 'editor' })).files.complete({ fileId: FILE_ID });

    expect(result.state).toBe('failed');
    expect(result.failure?.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(storage.remove).toHaveBeenCalledWith(fileRow().storageKey);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.rejected', outcome: 'error' }),
    );
  });

  it('fails when the stored size disagrees with what was announced', async () => {
    prismaMock.file.findFirst.mockResolvedValue(fileRow());
    prismaMock.file.update.mockImplementation(async ({ data }: { data: object }) =>
      fileRow({ ...data }),
    );
    storage.headBytes.mockResolvedValue(99);

    const result = await caller(ctx({ role: 'editor' })).files.complete({ fileId: FILE_ID });
    expect(result.failure?.code).toBe('FILE_SIZE_MISMATCH');
  });

  it('fails when nothing was uploaded at all', async () => {
    prismaMock.file.findFirst.mockResolvedValue(fileRow());
    prismaMock.file.update.mockImplementation(async ({ data }: { data: object }) =>
      fileRow({ ...data }),
    );
    storage.headBytes.mockResolvedValue(null);

    const result = await caller(ctx({ role: 'editor' })).files.complete({ fileId: FILE_ID });
    expect(result.failure?.code).toBe('FILE_MISSING');
  });

  it('is idempotent for a file that is already ready', async () => {
    prismaMock.file.findFirst.mockResolvedValue(fileRow({ state: 'ready' }));
    const result = await caller(ctx({ role: 'editor' })).files.complete({ fileId: FILE_ID });
    expect(result.state).toBe('ready');
    expect(prismaMock.file.update).not.toHaveBeenCalled();
  });

  it('cannot reach a file in another org', async () => {
    prismaMock.file.findFirst.mockResolvedValue(null);
    await expect(
      caller(ctx({ role: 'editor' })).files.complete({ fileId: FILE_ID }),
    ).rejects.toThrow(/no longer exists/i);
  });
});

describe('files.get / list / download / delete', () => {
  it('returns a dto with the failure and variant blocks', async () => {
    prismaMock.file.findFirst.mockResolvedValue(
      fileRow({ state: 'failed', failureCode: 'FILE_TYPE_NOT_ALLOWED', failureMessage: 'no' }),
    );
    const result = await caller(ctx({ role: 'viewer' })).files.get({ fileId: FILE_ID });
    expect(result).toMatchObject({
      failure: { code: 'FILE_TYPE_NOT_ALLOWED', message: 'no' },
      variants: { thumb: null, preview: null, pageCount: null },
      bytes: 8,
    });
  });

  it('lists the newest live files of a project', async () => {
    prismaMock.file.findMany.mockResolvedValue([fileRow()]);
    const result = await caller(ctx({ role: 'viewer' })).files.list({ projectId: PROJECT_ID });
    expect(result).toHaveLength(1);
    expect(prismaMock.file.findMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  it('serves images inline and other kinds as an attachment', async () => {
    prismaMock.file.findFirst.mockResolvedValue(fileRow({ state: 'ready' }));
    await caller(ctx({ role: 'viewer' })).files.download({ fileId: FILE_ID });
    expect(storage.presignGet).toHaveBeenLastCalledWith(fileRow().storageKey, 900, {
      filename: 'evidence.png',
      attachment: false,
    });

    prismaMock.file.findFirst.mockResolvedValue(
      fileRow({ state: 'ready', kind: 'archive', filename: 'dump.zip' }),
    );
    await caller(ctx({ role: 'viewer' })).files.download({ fileId: FILE_ID });
    expect(storage.presignGet).toHaveBeenLastCalledWith(fileRow().storageKey, 900, {
      filename: 'dump.zip',
      attachment: true,
    });
  });

  it('refuses to hand out a url for a file that is not ready, or a missing variant', async () => {
    prismaMock.file.findFirst.mockResolvedValue(fileRow({ state: 'pending' }));
    await expect(
      caller(ctx({ role: 'viewer' })).files.download({ fileId: FILE_ID }),
    ).rejects.toThrow(/still being processed/);

    prismaMock.file.findFirst.mockResolvedValue(fileRow({ state: 'ready' }));
    await expect(
      caller(ctx({ role: 'viewer' })).files.download({ fileId: FILE_ID, variant: 'thumb' }),
    ).rejects.toThrow(/has not been generated/);
  });

  it('soft-deletes and audits', async () => {
    prismaMock.file.findFirst.mockResolvedValue(fileRow({ state: 'ready' }));
    prismaMock.file.update.mockResolvedValue(fileRow());

    expect(await caller(ctx({ role: 'editor' })).files.delete({ fileId: FILE_ID })).toEqual({
      ok: true,
    });
    expect(prismaMock.file.update.mock.calls[0]?.[0]?.data.deletedAt).toBeInstanceOf(Date);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.deleted' }),
    );
  });
});
