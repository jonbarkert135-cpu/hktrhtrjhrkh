/**
 * Upload policy: kinds, size caps, the MIME allowlist and the object key layout.
 * Encodes 09_BACKEND.md §7.1/§7.3 and 15_SECURITY.md §5 as pure data + pure functions, so the
 * API, the worker and the SPA all reject the same files with the same words.
 */

export const FILE_KINDS = [
  'image',
  'pdf',
  'document',
  'spreadsheet',
  'data',
  'archive',
  'video',
  'audio',
  'other',
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

/** Per-kind size caps in bytes (09_BACKEND.md §7.3). */
export const MAX_BYTES_BY_KIND: Readonly<Record<FileKind, number>> = {
  image: 25 * 1024 * 1024,
  pdf: 100 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  spreadsheet: 50 * 1024 * 1024,
  data: 25 * 1024 * 1024,
  archive: 200 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  audio: 500 * 1024 * 1024,
  other: 100 * 1024 * 1024,
};

/** Schema-level hard cap, independent of kind. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/** Above this, the client must use multipart with 8 MB parts and parallelism 4. */
export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;
export const UPLOAD_CONCURRENCY = 4;

/** Presigned URL lifetime in seconds. */
export const PRESIGN_TTL_SECONDS = 900;

/** The allowlist: sniffable MIME type → kind. Anything absent is refused. */
export const ALLOWED_MIME: Readonly<Record<string, FileKind>> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/avif': 'image',
  'image/svg+xml': 'image',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.oasis.opendocument.text': 'document',
  'application/rtf': 'document',
  'text/plain': 'document',
  'text/markdown': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'spreadsheet',
  'text/csv': 'spreadsheet',
  'text/tab-separated-values': 'spreadsheet',
  'application/json': 'data',
  'application/x-ndjson': 'data',
  'application/xml': 'data',
  'application/yaml': 'data',
  'application/zip': 'archive',
  'application/x-tar': 'archive',
  'application/gzip': 'archive',
  'application/x-7z-compressed': 'archive',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
};

/** Extensions that are never accepted, whatever they sniff as (09_BACKEND.md §7.3). */
export const BLOCKED_EXTENSIONS = [
  'exe',
  'dll',
  'so',
  'dylib',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'iso',
  'dmg',
  'app',
  'jar',
  'docm',
  'xlsm',
  'pptm',
] as const;

/** Extension → the kind its name claims. Used to catch polyglots (a `.png` that sniffs as HTML). */
export const EXTENSION_KIND: Readonly<Record<string, FileKind>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  avif: 'image',
  svg: 'image',
  pdf: 'pdf',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  txt: 'document',
  md: 'document',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  json: 'data',
  ndjson: 'data',
  xml: 'data',
  yaml: 'data',
  yml: 'data',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  '7z': 'archive',
  mp4: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
};

/** Kind for an allowed MIME type; `other` for anything not in the allowlist. */
export function kindForMime(mime: string): FileKind {
  return ALLOWED_MIME[(mime.toLowerCase().split(';')[0] ?? '').trim()] ?? 'other';
}

/** Lowercase extension without the dot, or `''` when the name has none. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * A storage-safe rendition of the user's filename: ASCII-ish, no separators, no leading dots,
 * length-capped. The original name is kept verbatim in the database row for display.
 */
export function slugFilename(filename: string): string {
  const ext = extensionOf(filename);
  const stem = ext === '' ? filename : filename.slice(0, filename.length - ext.length - 1);
  const safeStem =
    stem
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80)
      .toLowerCase() || 'file';
  const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 12);
  return safeExt === '' ? safeStem : `${safeStem}.${safeExt}`;
}

/** Server-generated object key. Never derived from client input alone (15_SECURITY.md §5). */
export function fileObjectKey(input: {
  orgId: string;
  projectId: string;
  fileId: string;
  filename: string;
}): string {
  return `org/${input.orgId}/proj/${input.projectId}/${input.fileId}/${slugFilename(input.filename)}`;
}

/** Key of a generated derivative; idempotent by `fileId + variant` (P4 §7). */
export function derivativeKey(input: {
  orgId: string;
  projectId: string;
  fileId: string;
  variant: 'thumb' | 'preview';
  extension: string;
}): string {
  return `org/${input.orgId}/proj/${input.projectId}/${input.fileId}/${input.variant}.${input.extension}`;
}

export interface UploadRejection {
  code:
    | 'FILE_EMPTY'
    | 'FILE_NAME_INVALID'
    | 'FILE_EXTENSION_BLOCKED'
    | 'FILE_TYPE_NOT_ALLOWED'
    | 'FILE_TOO_LARGE';
  /** Sentence shown to the user verbatim (03_UX.md §12: say the number and the way out). */
  message: string;
}

const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Validate a declared upload before any bytes move. The declared MIME is untrusted — it only
 * decides which cap applies; the sniffed type decides acceptance after the upload (§7.2).
 */
export function validateUpload(input: {
  filename: string;
  declaredMime: string;
  bytes: number;
}): UploadRejection | null {
  const { filename, declaredMime, bytes } = input;
  if (filename.trim() === '' || filename.includes('/') || filename.includes('\0')) {
    return {
      code: 'FILE_NAME_INVALID',
      message: 'That filename can’t be stored. Rename the file and try again.',
    };
  }
  const extension = extensionOf(filename);
  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      code: 'FILE_EXTENSION_BLOCKED',
      message: `.${extension} files aren’t accepted. Link to the file instead, or upload it inside a zip archive.`,
    };
  }
  if (bytes <= 0) {
    return { code: 'FILE_EMPTY', message: 'That file is empty — there is nothing to upload.' };
  }
  const kind = kindForMime(declaredMime);
  if (kind === 'other' && !(extension in EXTENSION_KIND)) {
    return {
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: `Files of type ${declaredMime || 'unknown'} aren’t accepted. Link to the file instead.`,
    };
  }
  const cap = Math.min(MAX_BYTES_BY_KIND[kind], MAX_FILE_BYTES);
  if (bytes > cap) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `Upload failed — the file is ${mb(bytes)}, the limit is ${mb(cap)}. Compress it or link it instead.`,
    };
  }
  return null;
}

/** How the client should upload a file of this size. */
export function uploadMode(bytes: number): 'single' | 'multipart' {
  return bytes > MULTIPART_THRESHOLD_BYTES ? 'multipart' : 'single';
}

/** Byte ranges of the 8 MB parts a multipart upload is split into. */
export function multipartParts(
  bytes: number,
): { partNumber: number; start: number; end: number }[] {
  const parts: { partNumber: number; start: number; end: number }[] = [];
  for (let start = 0, n = 1; start < bytes; start += MULTIPART_PART_BYTES, n += 1) {
    parts.push({ partNumber: n, start, end: Math.min(start + MULTIPART_PART_BYTES, bytes) });
  }
  return parts;
}
