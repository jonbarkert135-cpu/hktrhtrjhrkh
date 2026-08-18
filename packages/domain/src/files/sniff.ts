/**
 * Magic-byte sniffing over the first 64 KB of an upload (09_BACKEND.md §7.2 step 1-3).
 * The client's declared MIME is never trusted: the sniffed type wins, and a file whose sniffed
 * family disagrees with its extension family is rejected as a polyglot.
 */
import { EXTENSION_KIND, extensionOf, kindForMime, type FileKind } from './policy.ts';

/** How many leading bytes the caller must supply for a decision. */
export const SNIFF_WINDOW_BYTES = 64 * 1024;

interface Signature {
  mime: string;
  /** Byte prefix at `offset`; `null` in a slot means "any byte". */
  bytes: readonly (number | null)[];
  offset?: number;
  /** Extra check for containers whose header alone is ambiguous (zip: docx/xlsx/ods vs plain zip). */
  refine?: (head: Uint8Array) => string;
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

const includesAscii = (head: Uint8Array, needle: string, limit = 4096): boolean => {
  const bytes = ascii(needle);
  const end = Math.min(head.length, limit) - bytes.length;
  for (let i = 0; i <= end; i += 1) {
    let hit = true;
    for (let j = 0; j < bytes.length; j += 1) {
      if (head[i + j] !== bytes[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
};

/** Zip containers: the first entry name tells docx/xlsx/odt/ods apart from a plain archive. */
function refineZip(head: Uint8Array): string {
  if (includesAscii(head, 'word/')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (includesAscii(head, 'xl/')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (includesAscii(head, 'mimetypeapplication/vnd.oasis.opendocument.text')) {
    return 'application/vnd.oasis.opendocument.text';
  }
  if (includesAscii(head, 'mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) {
    return 'application/vnd.oasis.opendocument.spreadsheet';
  }
  return 'application/zip';
}

const SIGNATURES: readonly Signature[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: ascii('GIF8') },
  {
    mime: 'image/webp',
    bytes: [...ascii('RIFF'), null, null, null, null, ...ascii('WEBP')],
  },
  { mime: 'image/avif', bytes: [...ascii('ftypavif')], offset: 4 },
  { mime: 'application/pdf', bytes: ascii('%PDF-') },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04], refine: refineZip },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x05, 0x06], refine: refineZip },
  { mime: 'application/gzip', bytes: [0x1f, 0x8b] },
  { mime: 'application/x-7z-compressed', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { mime: 'application/x-tar', bytes: ascii('ustar'), offset: 257 },
  { mime: 'application/rtf', bytes: ascii('{\\rtf') },
  { mime: 'video/mp4', bytes: ascii('ftyp'), offset: 4 },
  { mime: 'video/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { mime: 'audio/mpeg', bytes: ascii('ID3') },
  { mime: 'audio/mpeg', bytes: [0xff, 0xfb] },
  { mime: 'audio/wav', bytes: [...ascii('RIFF'), null, null, null, null, ...ascii('WAVE')] },
  // Executables and disk images have no allowlist entry, but naming them makes the rejection
  // message specific instead of "unrecognised".
  { mime: 'application/x-msdownload', bytes: [0x4d, 0x5a] },
  { mime: 'application/x-executable', bytes: [0x7f, ...ascii('ELF')] },
  { mime: 'application/x-mach-binary', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
];

const matches = (head: Uint8Array, sig: Signature): boolean => {
  const offset = sig.offset ?? 0;
  if (head.length < offset + sig.bytes.length) return false;
  return sig.bytes.every((b, i) => b === null || head[offset + i] === b);
};

const startsWithAscii = (head: Uint8Array, text: string): boolean =>
  matches(head, { mime: '', bytes: ascii(text) });

/** Text formats have no magic bytes; these are deliberate, conservative heuristics. */
function sniffText(head: Uint8Array): string | null {
  let text = '';
  for (let i = 0; i < Math.min(head.length, 4096); i += 1) {
    const byte = head[i] ?? 0;
    // A NUL byte in the first 4 KB means this is not text.
    if (byte === 0) return null;
    text += String.fromCharCode(byte);
  }
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) return 'text/html';
  if (lower.startsWith('<?xml') || lower.startsWith('<svg')) {
    return lower.includes('<svg') ? 'image/svg+xml' : 'application/xml';
  }
  if (trimmed.startsWith('#!')) return 'text/x-shellscript';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'application/json';
  return 'text/plain';
}

export interface SniffResult {
  mime: string;
  kind: FileKind;
}

/**
 * Best-effort content type of a blob from its first bytes. Returns `null` only when the window
 * is empty. Binary signatures are checked before the text heuristics, so a polyglot that starts
 * with a real header is reported as that header's type.
 */
export function sniffMime(head: Uint8Array): SniffResult | null {
  if (head.length === 0) return null;
  for (const sig of SIGNATURES) {
    if (!matches(head, sig)) continue;
    // `ftyp` boxes: avif is matched by its own signature above, everything else is mp4-family.
    if (sig.mime === 'video/mp4' && startsWithAscii(head.subarray(4), 'ftypavif')) continue;
    const mime = sig.refine ? sig.refine(head) : sig.mime;
    return { mime, kind: kindForMime(mime) };
  }
  const text = sniffText(head);
  if (text === null) return { mime: 'application/octet-stream', kind: 'other' };
  return { mime: text, kind: kindForMime(text) };
}

/** Kinds whose members are indistinguishable from raw bytes because they are all text. */
const TEXT_KINDS: ReadonlySet<FileKind> = new Set<FileKind>(['document', 'spreadsheet', 'data']);

export interface SniffVerdict {
  ok: boolean;
  mime: string;
  kind: FileKind;
  code?: 'FILE_TYPE_NOT_ALLOWED' | 'FILE_TYPE_MISMATCH' | 'FILE_UNREADABLE';
  message?: string;
}

/**
 * Apply the §7.2 mismatch policy to a sniffed blob.
 * A rejected verdict is terminal: the caller sets `state='failed'` and deletes the blob.
 */
export function verifySniffedType(input: { head: Uint8Array; filename: string }): SniffVerdict {
  const sniffed = sniffMime(input.head);
  if (sniffed === null) {
    return {
      ok: false,
      mime: 'application/octet-stream',
      kind: 'other',
      code: 'FILE_UNREADABLE',
      message: 'The uploaded file arrived empty. Try uploading it again.',
    };
  }
  const extensionKind = EXTENSION_KIND[extensionOf(input.filename)];
  // Plain-text formats (csv, tsv, yaml, ndjson, md…) share one signature: bytes that are text.
  // For those the extension is the only available discriminator and is safe to trust — every
  // text kind is inert. Binary families are still held to the strict check below.
  if (
    TEXT_KINDS.has(sniffed.kind) &&
    extensionKind !== undefined &&
    TEXT_KINDS.has(extensionKind)
  ) {
    return { ok: true, mime: sniffed.mime, kind: extensionKind };
  }
  if (sniffed.kind === 'other') {
    return {
      ...sniffed,
      ok: false,
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: `The file’s real type is ${sniffed.mime}, which isn’t accepted. Link to it instead.`,
    };
  }
  if (extensionKind !== undefined && extensionKind !== sniffed.kind) {
    return {
      ...sniffed,
      ok: false,
      code: 'FILE_TYPE_MISMATCH',
      message: `The file is named like a ${extensionKind} but its contents are ${sniffed.mime}. It was rejected for safety.`,
    };
  }
  return { ...sniffed, ok: true };
}
