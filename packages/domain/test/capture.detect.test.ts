/**
 * P6 §5.1 — the detection matrix. Order is a product decision (files → image → html → uri-list →
 * text URLs → text → nothing), so it is pinned here rather than left to whichever branch runs first.
 */

import { describe, expect, it } from 'vitest';

import { detectTransfer } from '../src/capture/detect.ts';
import {
  MAX_PASTE_URLS,
  extractUrls,
  htmlToPlainText,
  isSingleUrl,
  urlsFromHtml,
  urlsFromUriList,
} from '../src/capture/parse.ts';

const png = { name: 'shot.png', type: 'image/png', size: 1024 };
const pdf = { name: 'report.pdf', type: 'application/pdf', size: 4096 };

describe('detectTransfer', () => {
  it('returns nothing for an empty transfer', () => {
    expect(detectTransfer({})).toEqual({ kind: 'none', reason: 'Nothing to paste' });
  });

  it('prefers files over any text payload', () => {
    const result = detectTransfer({ files: [pdf], text: 'https://example.com' });
    expect(result).toEqual({ kind: 'files', files: [pdf] });
  });

  it('treats an all-image transfer as an image and keeps the text as the caption', () => {
    const result = detectTransfer({ files: [png], text: 'Figure 2' });
    expect(result).toEqual({ kind: 'image', files: [png], caption: 'Figure 2' });
  });

  it('falls back to files when images are mixed with other files', () => {
    expect(detectTransfer({ files: [png, pdf] }).kind).toBe('files');
  });

  it('reads links out of text/html before text/uri-list', () => {
    const result = detectTransfer({
      html: '<a href="https://a.example/x">a</a>',
      uriList: 'https://b.example/',
      text: 'https://c.example/',
    });
    expect(result).toEqual({
      kind: 'urls',
      urls: ['https://a.example/x'],
      total: 1,
      truncated: false,
    });
  });

  it('uses the plain text of an HTML paste that carries no link', () => {
    expect(detectTransfer({ html: '<p>Hello <b>there</b></p>' })).toEqual({
      kind: 'text',
      text: 'Hello there',
    });
  });

  it('uses text/uri-list when there is no html', () => {
    const result = detectTransfer({ uriList: '# comment\nhttps://b.example/\n' });
    expect(result).toEqual({
      kind: 'urls',
      urls: ['https://b.example/'],
      total: 1,
      truncated: false,
    });
  });

  it('detects a multi-URL plain-text paste', () => {
    const result = detectTransfer({ text: 'https://a.example/\nhttps://b.example/' });
    expect(result).toEqual({
      kind: 'urls',
      urls: ['https://a.example/', 'https://b.example/'],
      total: 2,
      truncated: false,
    });
  });

  it('caps an over-long URL paste at 50 and reports the real total', () => {
    const text = Array.from({ length: 120 }, (_, i) => `https://x${String(i)}.example/`).join('\n');
    const result = detectTransfer({ text });
    if (result.kind !== 'urls') throw new Error('expected urls');
    expect(result.urls).toHaveLength(MAX_PASTE_URLS);
    expect(result.total).toBe(120);
    expect(result.truncated).toBe(true);
  });

  it('keeps prose that merely contains a link as text', () => {
    expect(detectTransfer({ text: 'see https://a.example/ for details' })).toEqual({
      kind: 'text',
      text: 'see https://a.example/ for details',
    });
  });
});

describe('parse helpers', () => {
  it('extracts and de-duplicates URLs, trimming trailing punctuation', () => {
    expect(
      extractUrls('https://a.example/x, https://a.example/x and https://b.example/y.'),
    ).toEqual(['https://a.example/x', 'https://b.example/y']);
  });

  it('recognises a bare single URL', () => {
    expect(isSingleUrl('  https://a.example/x ')).toBe(true);
    expect(isSingleUrl('https://a.example/x and more')).toBe(false);
    expect(isSingleUrl('not a url')).toBe(false);
  });

  it('reads hrefs first, then bare URLs from markup', () => {
    expect(urlsFromHtml('<a href="https://a.example/">x</a> https://b.example/')).toEqual([
      'https://a.example/',
      'https://b.example/',
    ]);
  });

  it('ignores comments and non-http lines in a uri-list', () => {
    expect(urlsFromUriList('#c\nftp://x/\nhttps://a.example/\n\n')).toEqual(['https://a.example/']);
  });

  it('strips scripts and tags from html', () => {
    expect(htmlToPlainText('<style>a{}</style><p>a &amp; b</p>')).toBe('a & b');
  });
});
