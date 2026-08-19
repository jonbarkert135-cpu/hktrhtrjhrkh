/**
 * Unfurl metadata extraction (P6 §5.7, §7). Pure over the first 512 KB of a page: the full body is
 * never buffered, and everything extracted is treated as untrusted — stripped of markup, length
 * capped (title 300, description 1000) and never handed to the UI as HTML (§9).
 */

import { htmlToPlainText } from '../capture/parse.ts';
import { normalizeUrl } from './urlValidator.ts';

/** Only the head is parsed; metadata that is not there by 512 KB is not metadata. */
export const HEAD_SCAN_BYTES = 512 * 1024;
export const UNFURL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const UNFURL_NEGATIVE_TTL_MS = 60 * 60 * 1000;

export const TITLE_MAX = 300;
export const DESCRIPTION_MAX = 1000;

export interface UnfurlMetadata {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  canonicalUrl: string | null;
  favicon: string | null;
  ogImage: string | null;
  publishedAt: string | null;
  author: string | null;
}

const cap = (value: string | null, max: number): string | null => {
  if (value === null) return null;
  const text = htmlToPlainText(value).slice(0, max).trim();
  return text === '' ? null : text;
};

/** All `<meta>` tags as a lowercase `name|property` → content map, attribute order independent. */
function metaTags(head: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of head.matchAll(TAG('meta'))) {
    const tag = match[0];
    const key =
      attr(tag, 'property') ??
      attr(tag, 'name') ??
      attr(tag, 'itemprop') ??
      attr(tag, 'http-equiv');
    const content = attr(tag, 'content');
    if (key === null || content === null) continue;
    const lower = key.toLowerCase();
    if (!tags.has(lower)) tags.set(lower, content);
  }
  return tags;
}

/** Quote-aware tag matcher: a `>` inside an attribute value must not end the tag. */
const TAG = (name: string): RegExp => new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match === null ? null : (match[2] ?? match[3] ?? match[4] ?? null);
}

/** `link[rel=icon]` variants first, then `/favicon.ico` — the glyph fallback is the UI's job (§7). */
function faviconHref(head: string, base: URL): string | null {
  for (const match of head.matchAll(TAG('link'))) {
    const tag = match[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    if (!/\b(icon|shortcut icon|apple-touch-icon)\b/.test(rel)) continue;
    const href = attr(tag, 'href');
    if (href !== null) return absolute(href, base);
  }
  return absolute('/favicon.ico', base);
}

function absolute(href: string, base: URL): string | null {
  if (href.trim() === '') return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Parses metadata out of a page. `finalUrl` is the URL after redirects, used to resolve relative
 * icon paths and as the title fallback (a page with no title becomes domain + path, §8).
 */
export function parseUnfurl(html: string, finalUrl: string): UnfurlMetadata {
  const head = html.slice(0, HEAD_SCAN_BYTES);
  const base = new URL(finalUrl);
  const meta = metaTags(head);
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = meta.get(key);
      if (value !== undefined && value.trim() !== '') return value;
    }
    return null;
  };

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null;
  const title =
    cap(pick('og:title', 'twitter:title') ?? titleTag, TITLE_MAX) ??
    `${base.hostname}${base.pathname === '/' ? '' : base.pathname}`;

  const canonicalTag = [...head.matchAll(TAG('link'))]
    .map((match) => match[0])
    .find((tag) => (attr(tag, 'rel') ?? '').toLowerCase() === 'canonical');

  return {
    url: base.href,
    title,
    description: cap(pick('og:description', 'twitter:description', 'description'), DESCRIPTION_MAX),
    siteName: cap(pick('og:site_name', 'application-name'), TITLE_MAX),
    canonicalUrl:
      canonicalTag === undefined ? null : absolute(attr(canonicalTag, 'href') ?? '', base),
    favicon: faviconHref(head, base),
    ogImage: absolute(pick('og:image', 'og:image:url', 'twitter:image') ?? '', base),
    publishedAt: cap(pick('article:published_time', 'datepublished', 'date'), 40),
    author: cap(pick('article:author', 'author', 'twitter:creator'), TITLE_MAX),
  };
}

/** Cache key: the normalized URL, so `?utm_x` and a trailing slash do not split the entry (§5.8). */
export const unfurlCacheKey = (url: string): string => normalizeUrl(url);
