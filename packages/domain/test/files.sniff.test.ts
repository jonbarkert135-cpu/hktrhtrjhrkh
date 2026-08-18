import { describe, expect, it } from 'vitest';
import { sniffMime, verifySniffedType } from '../src/files/sniff.ts';

const bytes = (...values: (number | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === 'number') out.push(value);
    else for (const char of value) out.push(char.charCodeAt(0));
  }
  return new Uint8Array(out);
};

const pad = (head: Uint8Array, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  out.set(head, 0);
  return out;
};

const PNG = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const GIF = bytes('GIF89a');
const WEBP = bytes('RIFF', 0, 0, 0, 0, 'WEBP');
const PDF = bytes('%PDF-1.7');
const ZIP = bytes('PK', 0x03, 0x04);
const DOCX = bytes('PK', 0x03, 0x04, 0, 0, 0, 0, 'word/document.xml');
const XLSX = bytes('PK', 0x03, 0x04, 0, 0, 0, 0, 'xl/workbook.xml');
const GZIP = bytes(0x1f, 0x8b, 0x08);
const ELF = bytes(0x7f, 'ELF');
const MZ = bytes('MZ', 0x90, 0x00);
const HTML = bytes('<!DOCTYPE html><html><body>hi</body></html>');
const SVG = bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
const CSV = bytes('name,handle\nada,@ada\n');
const JSON_DOC = bytes('{"a":1}');

describe('sniffMime', () => {
  it.each([
    ['png', PNG, 'image/png'],
    ['jpeg', JPEG, 'image/jpeg'],
    ['gif', GIF, 'image/gif'],
    ['webp', WEBP, 'image/webp'],
    ['pdf', PDF, 'application/pdf'],
    ['zip', ZIP, 'application/zip'],
    ['docx', DOCX, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['xlsx', XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['gzip', GZIP, 'application/gzip'],
    ['elf', ELF, 'application/x-executable'],
    ['windows exe', MZ, 'application/x-msdownload'],
    ['html', HTML, 'text/html'],
    ['svg', SVG, 'image/svg+xml'],
    ['json', JSON_DOC, 'application/json'],
    ['csv', CSV, 'text/plain'],
  ])('recognises %s', (_label, head, mime) => {
    expect(sniffMime(head)?.mime).toBe(mime);
  });

  it('reads tar headers at offset 257', () => {
    const tar = pad(new Uint8Array(), 512);
    tar.set(bytes('ustar'), 257);
    expect(sniffMime(tar)?.mime).toBe('application/x-tar');
  });

  it('separates avif from other ftyp boxes', () => {
    expect(sniffMime(bytes(0, 0, 0, 0x20, 'ftypavif'))?.mime).toBe('image/avif');
    expect(sniffMime(bytes(0, 0, 0, 0x20, 'ftypisom'))?.mime).toBe('video/mp4');
  });

  it('returns octet-stream for unrecognised binary and null for nothing at all', () => {
    expect(sniffMime(bytes(0x00, 0x01, 0x02, 0x00))?.mime).toBe('application/octet-stream');
    expect(sniffMime(new Uint8Array())).toBeNull();
  });
});

describe('verifySniffedType — hostile corpus (09_BACKEND.md §7.2)', () => {
  it('accepts a real image with a matching name', () => {
    expect(verifySniffedType({ head: PNG, filename: 'evidence.png' })).toMatchObject({
      ok: true,
      mime: 'image/png',
      kind: 'image',
    });
  });

  it('rejects html wearing a .png extension (polyglot / stored XSS attempt)', () => {
    const verdict = verifySniffedType({ head: HTML, filename: 'avatar.png' });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(verdict.message).toContain('text/html');
  });

  it('rejects an executable renamed to .pdf', () => {
    const verdict = verifySniffedType({ head: MZ, filename: 'invoice.pdf' });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('rejects a zip archive renamed to .jpg (family mismatch)', () => {
    const verdict = verifySniffedType({ head: ZIP, filename: 'holiday.jpg' });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('FILE_TYPE_MISMATCH');
    expect(verdict.message).toContain('named like a image');
  });

  it('rejects an empty upload', () => {
    expect(verifySniffedType({ head: new Uint8Array(), filename: 'a.png' }).code).toBe(
      'FILE_UNREADABLE',
    );
  });

  it('trusts the extension among text kinds, which are all inert', () => {
    expect(verifySniffedType({ head: CSV, filename: 'targets.csv' })).toMatchObject({
      ok: true,
      kind: 'spreadsheet',
    });
    expect(verifySniffedType({ head: CSV, filename: 'config.yaml' })).toMatchObject({
      ok: true,
      kind: 'data',
    });
    expect(verifySniffedType({ head: JSON_DOC, filename: 'dump.json' })).toMatchObject({
      ok: true,
      kind: 'data',
    });
  });

  it('accepts a docx by its container contents, not its name', () => {
    expect(verifySniffedType({ head: DOCX, filename: 'brief.docx' })).toMatchObject({
      ok: true,
      kind: 'document',
    });
  });

  it('accepts a file with no extension when the bytes are allowed', () => {
    expect(verifySniffedType({ head: PDF, filename: 'scan' })).toMatchObject({
      ok: true,
      kind: 'pdf',
    });
  });
});
