/**
 * Unfurl metadata extraction (P6 §5.7, §7, §8). Untrusted input: the parser must survive missing
 * tags, markup inside a title and a page far larger than the head budget.
 */

import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX,
  HEAD_SCAN_BYTES,
  TITLE_MAX,
  parseUnfurl,
  unfurlCacheKey,
} from '../src/net/unfurl.ts';

const page = `
<html><head>
  <title>Fallback title</title>
  <meta property="og:title" content="Open Graph title">
  <meta name="description" content="A <b>description</b>">
  <meta property="og:site_name" content="Example News">
  <meta property="article:published_time" content="2026-01-02T03:04:05Z">
  <meta name="author" content="A. Analyst">
  <meta property="og:image" content="/img/hero.png">
  <link rel="canonical" href="https://example.com/canonical">
  <link rel="icon" href="/static/icon.svg">
</head><body>ignored</body></html>`;

describe('parseUnfurl', () => {
  it('extracts every field and resolves relative URLs against the final URL', () => {
    expect(parseUnfurl(page, 'https://example.com/a/b')).toEqual({
      url: 'https://example.com/a/b',
      title: 'Open Graph title',
      description: 'A description',
      siteName: 'Example News',
      canonicalUrl: 'https://example.com/canonical',
      favicon: 'https://example.com/static/icon.svg',
      ogImage: 'https://example.com/img/hero.png',
      publishedAt: '2026-01-02T03:04:05Z',
      author: 'A. Analyst',
    });
  });

  it('falls back to <title>, then to domain + path when there is no title at all', () => {
    expect(
      parseUnfurl('<html><head><title>Only</title></head></html>', 'https://x.example/a').title,
    ).toBe('Only');
    expect(parseUnfurl('<html></html>', 'https://x.example/a/b').title).toBe('x.example/a/b');
    expect(parseUnfurl('<html></html>', 'https://x.example/').title).toBe('x.example');
  });

  it('falls back to /favicon.ico and returns null metadata rather than empty strings', () => {
    const meta = parseUnfurl('<html><head></head></html>', 'https://x.example/');
    expect(meta.favicon).toBe('https://x.example/favicon.ico');
    expect(meta.description).toBeNull();
    expect(meta.ogImage).toBeNull();
    expect(meta.canonicalUrl).toBeNull();
    expect(meta.author).toBeNull();
  });

  it('caps title and description and strips markup (metadata is untrusted)', () => {
    const hostile = `<html><head><title>${'t'.repeat(500)}</title>
      <meta name="description" content="${'d'.repeat(2000)}"></head></html>`;
    const meta = parseUnfurl(hostile, 'https://x.example/');
    expect(meta.title).toHaveLength(TITLE_MAX);
    expect(meta.description).toHaveLength(DESCRIPTION_MAX);

    const scripted = parseUnfurl(
      '<html><head><title>a<script>alert(1)</script>b</title></head></html>',
      'https://x.example/',
    );
    expect(scripted.title).not.toContain('<script>');
  });

  it('reads single-quoted and unquoted attributes', () => {
    const meta = parseUnfurl(
      "<html><head><meta property='og:title' content='Quoted'><link rel=icon href=/i.png></head></html>",
      'https://x.example/',
    );
    expect(meta.title).toBe('Quoted');
    expect(meta.favicon).toBe('https://x.example/i.png');
  });

  it('ignores metadata past the 512 KB head budget', () => {
    const padded = `<html><head>${' '.repeat(HEAD_SCAN_BYTES)}<title>Late</title></head></html>`;
    expect(parseUnfurl(padded, 'https://x.example/late').title).toBe('x.example/late');
  });

  it('ignores an empty href and keeps a > inside an attribute value', () => {
    const meta = parseUnfurl(
      '<html><head><link rel="canonical" href=""><meta property="og:title" content="a > b"></head></html>',
      'https://x.example/',
    );
    expect(meta.canonicalUrl).toBeNull();
    expect(meta.title).toBe('a > b');
  });

  it('keys the cache on the normalized URL', () => {
    expect(unfurlCacheKey('https://X.example/a/?utm_source=q')).toBe(
      unfurlCacheKey('https://x.example/a'),
    );
  });
});
