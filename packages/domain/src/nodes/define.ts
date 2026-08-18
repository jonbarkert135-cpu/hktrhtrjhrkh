/**
 * Small helpers shared by the built-in type definitions. They exist so a type file contains its
 * schema and its decisions — not boilerplate — which is what keeps "add a type = add a file" true.
 */

import { z } from 'zod';

import type { DataParser, NodeTypeDefinition, TypedNode } from './types.ts';

/** Identity function that pins the generic parameter, so `defaults.data` is checked against `schema`. */
export function defineNodeType<TData>(def: NodeTypeDefinition<TData>): NodeTypeDefinition<TData> {
  return def;
}

/** `https://example.com/a?b` → `example.com`. Returns '' for anything unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Static half of the SSRF guard (15_SECURITY.md §5). The authoritative check runs server-side; this
 * one keeps obviously unusable URLs out of the document and out of the enrichment queue.
 */
export function urlIssues(url: string, field: string): Array<{ code: string; message: string }> {
  if (url === '') return [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [
      {
        code: 'URL_MALFORMED',
        message: `${field} is not a valid URL. Include http:// or https://.`,
      },
    ];
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return [
      {
        code: 'URL_SCHEME',
        message: `Only http and https links are stored. "${parsed.protocol.replace(':', '')}" is not.`,
      },
    ];
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return [
      {
        code: 'URL_CREDENTIALS',
        message: 'Remove the username and password from the URL — credentials are never stored.',
      },
    ];
  }
  if (isPrivateHost(parsed.hostname)) {
    return [
      {
        code: 'URL_PRIVATE_RANGE',
        message: `${parsed.hostname} is a private or loopback address, so it cannot be fetched. The node is kept, enrichment is skipped.`,
      },
    ];
  }
  return [];
}

const PRIVATE_V4 =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    return true;
  if (
    host === '::1' ||
    host === '::' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  )
    return true;
  return PRIVATE_V4.test(host);
}

/** Collapses whitespace and clamps, so search text and card previews stay one predictable shape. */
export function clean(value: string | null | undefined, max = 4000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Keywords with the empties removed and duplicates collapsed, order preserved. */
export function keywords(...values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = clean(value, 200);
    if (text === '' || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

/**
 * Export/import pair for a plain `data` payload: export writes the parsed object, import re-parses
 * it. Unknown keys survive because every payload schema is `.passthrough()`.
 */
export function jsonIo<TData>(schema: DataParser<TData>): {
  toExport(node: TypedNode<TData>): Record<string, unknown>;
  fromExport(raw: unknown): TData;
} {
  return {
    toExport: (node) => ({ ...(node.data as Record<string, unknown>) }),
    fromExport: (raw) => schema.parse(raw ?? {}),
  };
}

/** A nullable, length-capped string field — the shape most enrichment outputs have. */
export const nullableText = (max: number): z.ZodDefault<z.ZodNullable<z.ZodString>> =>
  z.string().max(max).nullable().default(null);
