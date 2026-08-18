import { describe, expect, it } from 'vitest';
import {
  MAX_BYTES_BY_KIND,
  MULTIPART_THRESHOLD_BYTES,
  derivativeKey,
  extensionOf,
  fileObjectKey,
  kindForMime,
  multipartParts,
  slugFilename,
  uploadMode,
  validateUpload,
} from '../src/files/policy.ts';

describe('kindForMime', () => {
  it('maps allowlisted types to their kind and everything else to other', () => {
    expect(kindForMime('image/png')).toBe('image');
    expect(kindForMime('IMAGE/PNG')).toBe('image');
    expect(kindForMime('text/csv; charset=utf-8')).toBe('spreadsheet');
    expect(kindForMime('application/x-msdownload')).toBe('other');
    expect(kindForMime('')).toBe('other');
  });
});

describe('extensionOf / slugFilename', () => {
  it('reads the extension only when there is a real one', () => {
    expect(extensionOf('report.PDF')).toBe('pdf');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('archive.')).toBe('');
    expect(extensionOf('noext')).toBe('');
  });

  it('produces a storage-safe name and keeps the extension', () => {
    expect(slugFilename('Отчёт по цели №7.pdf')).toMatch(/^[\w.-]+\.pdf$/);
    expect(slugFilename('../../etc/passwd.txt')).toBe('etc-passwd.txt');
    expect(slugFilename('  .. ')).toBe('file');
    expect(slugFilename('a'.repeat(200) + '.png')).toHaveLength(84);
  });
});

describe('object keys', () => {
  it('are namespaced by org, project and file id', () => {
    const key = fileObjectKey({
      orgId: 'org1',
      projectId: 'prj1',
      fileId: 'fil1',
      filename: 'My Photo.PNG',
    });
    expect(key).toBe('org/org1/proj/prj1/fil1/my-photo.png');
    expect(
      derivativeKey({
        orgId: 'org1',
        projectId: 'prj1',
        fileId: 'fil1',
        variant: 'thumb',
        extension: 'webp',
      }),
    ).toBe('org/org1/proj/prj1/fil1/thumb.webp');
  });
});

describe('validateUpload', () => {
  const base = { filename: 'photo.png', declaredMime: 'image/png', bytes: 1024 };

  it('accepts an allowlisted file within its cap', () => {
    expect(validateUpload(base)).toBeNull();
  });

  it('rejects path-like and empty names', () => {
    expect(validateUpload({ ...base, filename: 'a/b.png' })?.code).toBe('FILE_NAME_INVALID');
    expect(validateUpload({ ...base, filename: '   ' })?.code).toBe('FILE_NAME_INVALID');
  });

  it('rejects blocked extensions before anything else', () => {
    const rejection = validateUpload({
      filename: 'setup.exe',
      declaredMime: 'application/octet-stream',
      bytes: 10,
    });
    expect(rejection?.code).toBe('FILE_EXTENSION_BLOCKED');
    expect(rejection?.message).toContain('.exe');
  });

  it('rejects empty files and unknown types', () => {
    expect(validateUpload({ ...base, bytes: 0 })?.code).toBe('FILE_EMPTY');
    expect(
      validateUpload({ filename: 'thing.qqq', declaredMime: 'application/x-thing', bytes: 10 })
        ?.code,
    ).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('names the size and the limit when a file is over the cap', () => {
    const rejection = validateUpload({ ...base, bytes: 142 * 1024 * 1024 });
    expect(rejection?.code).toBe('FILE_TOO_LARGE');
    expect(rejection?.message).toBe(
      'Upload failed — the file is 142 MB, the limit is 25 MB. Compress it or link it instead.',
    );
  });

  it('applies the per-kind cap, so a large pdf passes where a large image would not', () => {
    const bytes = MAX_BYTES_BY_KIND.image + 1;
    expect(
      validateUpload({ filename: 'doc.pdf', declaredMime: 'application/pdf', bytes }),
    ).toBeNull();
    expect(validateUpload({ ...base, bytes })?.code).toBe('FILE_TOO_LARGE');
  });
});

describe('multipart planning', () => {
  it('switches to multipart above 8 MB', () => {
    expect(uploadMode(MULTIPART_THRESHOLD_BYTES)).toBe('single');
    expect(uploadMode(MULTIPART_THRESHOLD_BYTES + 1)).toBe('multipart');
  });

  it('splits into 8 MB parts covering the file exactly once', () => {
    const bytes = 20 * 1024 * 1024;
    const parts = multipartParts(bytes);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ partNumber: 1, start: 0, end: 8 * 1024 * 1024 });
    expect(parts.at(-1)?.end).toBe(bytes);
    expect(parts.every((p, i) => i === 0 || p.start === parts[i - 1]?.end)).toBe(true);
  });
});
