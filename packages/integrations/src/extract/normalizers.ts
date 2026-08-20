/**
 * Per-entity-kind normalizers (10_INTEGRATIONS.md §8.1).
 *
 * Normalization is what makes a tool result merge with a hand-made node: two observations of the
 * same thing must reduce to the same canonical string, and anything that cannot be canonicalized is
 * rejected with a reason rather than imported as a near-duplicate.
 *
 * These functions are pure and dependency-free on purpose — `packages/integrations` may import only
 * `packages/domain` and `packages/config`, and this file runs in the worker, in tests and (through
 * the proposal review) conceptually in the browser.
 */

import type { EntityKind } from '../manifest.ts';

export interface NormalizeResult {
  ok: boolean;
  /** Canonical value; the identity key is built from this. */
  value?: string;
  /** Human form, kept for the UI. */
  display?: string;
  meta?: Record<string, unknown>;
  /** Present when `!ok`; used verbatim in the skip issue. */
  reason?: string;
}

export interface NormalizeContext {
  readonly defaultRegion?: string;
}

export type Normalizer = (raw: string, ctx?: NormalizeContext) => NormalizeResult;

const fail = (reason: string): NormalizeResult => ({ ok: false, reason });
const ok = (value: string, display: string, meta?: Record<string, unknown>): NormalizeResult => ({
  ok: true,
  value,
  display,
  ...(meta ? { meta } : {}),
});

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Tracking parameters dropped from every URL (§8.1). */
export const TRACKING_PARAMS: readonly string[] = [
  'fbclid',
  'gclid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
];

/**
 * Bare public suffixes we refuse as domains. A full PSL is a 250 KB dependency the spec wants
 * (`psl`, refreshed quarterly); until a tool needs the long tail this covers the multi-label
 * suffixes that actually show up in OSINT output, and anything single-label (`com`) is rejected by
 * the label-count rule below. Recorded as a deviation in the spec's status note.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.au',
  'net.au',
  'org.au',
  'com.br',
  'com.cn',
  'com.mx',
  'co.in',
  'co.nz',
  'co.za',
  'com.tr',
  'github.io',
]);

const TAG_SUPPORTING_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

const HEX = /^[0-9a-f]+$/;
const HASH_ALGOS: Readonly<Record<number, string>> = {
  32: 'md5',
  40: 'sha1',
  64: 'sha256',
  128: 'sha512',
};

/** RFC 5322 is not worth it here: the boundary check is zod-equivalent plus a length cap. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * IDN → punycode without pulling in a runtime: Node and every browser expose it through the URL
 * parser, which is the same UTS-46 implementation `url.domainToASCII` uses.
 */
function toAscii(host: string): string | undefined {
  try {
    const url = new URL(`http://${host}`);
    return url.hostname === '' ? undefined : url.hostname;
  } catch {
    return undefined;
  }
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** Rejects non-canonical dotted quads (`010.1.1.1`) as the spec requires. */
function canonicalIpv4(value: string): string | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    if (part.length > 1 && part.startsWith('0')) return undefined;
    if (Number(part) > 255) return undefined;
  }
  return parts.join('.');
}

/** Compresses an IPv6 address to its canonical (RFC 5952) form. */
function canonicalIpv6(raw: string): string | undefined {
  const value = raw.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(value) || !value.includes(':')) return undefined;
  const halves = value.split('::');
  if (halves.length > 2) return undefined;

  const expand = (part: string): string[] | undefined => {
    if (part === '') return [];
    const groups: string[] = [];
    for (const piece of part.split(':')) {
      if (piece.includes('.')) {
        const quad = canonicalIpv4(piece);
        if (quad === undefined) return undefined;
        const [a, b, c, d] = quad.split('.').map(Number) as [number, number, number, number];
        groups.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return undefined;
      groups.push(String(parseInt(piece, 16).toString(16)));
    }
    return groups;
  };

  const head = expand(halves[0] ?? '');
  const tail = halves.length === 2 ? expand(halves[1] ?? '') : [];
  if (head === undefined || tail === undefined) return undefined;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  const groups = [
    ...head,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'),
    ...tail,
  ];
  if (groups.length !== 8) return undefined;

  // Longest run of zero groups (≥ 2) collapses to `::`.
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i += 1) {
    if (i < groups.length && groups[i] === '0') {
      if (start === -1) start = i;
    } else if (start !== -1) {
      const len = i - start;
      if (len > bestLen && len >= 2) {
        bestStart = start;
        bestLen = len;
      }
      start = -1;
    }
  }
  if (bestStart === -1) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLen).join(':')}`;
}

export const RESERVED_IP_REASON = 'reserved, loopback or link-local address';

/** True for the ranges the SSRF policy never allows a tool to target (N7). */
export function isReservedIp(value: string): boolean {
  if (isIpv4(value)) {
    const [a = 0, b = 0] = value.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  const lower = value.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
  if (lower.startsWith('ff')) return true; // multicast
  return false;
}

const domain: Normalizer = (raw) => {
  const trimmed = raw.trim().replace(/\.+$/, '');
  if (trimmed === '' || CONTROL_CHARS.test(trimmed)) return fail('not a valid domain name');
  if (trimmed.includes('/') || trimmed.includes(' ')) return fail('not a valid domain name');
  const ascii = toAscii(trimmed.toLowerCase());
  if (ascii === undefined || ascii.startsWith('[')) return fail('not a valid domain name');
  const labels = ascii.split('.');
  if (labels.length < 2 || labels.some((label) => label === '')) {
    return fail('not a registrable domain name');
  }
  if (MULTI_LABEL_SUFFIXES.has(ascii)) return fail('is a bare public suffix');
  // `www.` is stripped for the identity only; the display keeps what the tool reported.
  const key = ascii.startsWith('www.') ? ascii.slice(4) : ascii;
  if (key.split('.').length < 2) return fail('not a registrable domain name');
  return ok(key, trimmed);
};

const url: Normalizer = (raw) => {
  const trimmed = raw.trim();
  if (trimmed === '' || CONTROL_CHARS.test(trimmed)) return fail('not a valid URL');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return fail('not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail('only http and https URLs are supported');
  }
  parsed.hash = '';
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }
  const params = [...parsed.searchParams.entries()]
    .filter(
      ([key]) =>
        !key.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.includes(key.toLowerCase()),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  parsed.search = '';
  for (const [key, value] of params) parsed.searchParams.append(key, value);
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return ok(parsed.toString(), trimmed, { host: parsed.hostname });
};

const email: Normalizer = (raw) => {
  const trimmed = raw.trim();
  if (trimmed.length > 254) return fail('longer than 254 characters');
  if (!EMAIL_RE.test(trimmed)) return fail('not a valid email address');
  const lower = trimmed.toLowerCase();
  const at = lower.lastIndexOf('@');
  const local = lower.slice(0, at);
  const host = lower.slice(at + 1);
  const keyLocal =
    TAG_SUPPORTING_DOMAINS.has(host) && local.includes('+')
      ? local.slice(0, local.indexOf('+'))
      : local;
  return ok(`${keyLocal}@${host}`, trimmed, { domain: host });
};

const username: Normalizer = (raw) => {
  const trimmed = raw.trim().replace(/^@+/, '');
  if (trimmed.length < 1 || trimmed.length > 64)
    return fail('username length must be 1–64 characters');
  if (/\s/.test(trimmed) || CONTROL_CHARS.test(trimmed))
    return fail('username contains whitespace');
  return ok(trimmed.toLowerCase(), trimmed);
};

/** Known platforms for `handle:<platform>:<lower>`; an unknown platform downgrades to `username`. */
export const KNOWN_HANDLE_PLATFORMS = new Set([
  'github',
  'gitlab',
  'x',
  'twitter',
  'mastodon',
  'reddit',
  'instagram',
  'telegram',
  'linkedin',
  'tiktok',
  'youtube',
  'keybase',
]);

/**
 * A handle is written `platform:name` or `@name@platform`; without a recognizable platform it is
 * indistinguishable from a username, and the spec says to downgrade rather than invent one.
 */
const handle: Normalizer = (raw, ctx) => {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(':');
  const platform = colon > 0 ? trimmed.slice(0, colon).toLowerCase() : '';
  const name = colon > 0 ? trimmed.slice(colon + 1) : trimmed;
  if (platform === '' || !KNOWN_HANDLE_PLATFORMS.has(platform)) {
    const downgraded = username(name, ctx);
    return downgraded.ok ? { ...downgraded, meta: { downgraded: true } } : downgraded;
  }
  const inner = username(name, ctx);
  if (!inner.ok || inner.value === undefined) return inner;
  return ok(`handle:${platform}:${inner.value}`, trimmed, { platform });
};

const ip: Normalizer = (raw) => {
  const trimmed = raw.trim();
  const v4 = canonicalIpv4(trimmed);
  if (v4 !== undefined) {
    if (isReservedIp(v4)) return fail(RESERVED_IP_REASON);
    return ok(v4, trimmed, { family: 4 });
  }
  const v6 = canonicalIpv6(trimmed);
  if (v6 !== undefined) {
    if (isReservedIp(v6)) return fail(RESERVED_IP_REASON);
    return ok(v6, trimmed, { family: 6 });
  }
  return fail('not a canonical IPv4 or IPv6 address');
};

const hash: Normalizer = (raw) => {
  const trimmed = raw.trim().toLowerCase();
  if (!HEX.test(trimmed)) return fail('not a hexadecimal digest');
  const algo = HASH_ALGOS[trimmed.length];
  if (algo === undefined) return fail('unknown digest length');
  return ok(trimmed, raw.trim(), { hashAlgo: algo });
};

/**
 * E.164 without `libphonenumber-js`: the metadata bundle is 140 KB and the only thing the pipeline
 * needs is a stable key. Numbers already in international form are canonicalized; a national number
 * with a known default region gets its calling code prefixed. Everything else is reported as not
 * parseable, which the caller downgrades to an `unknown` entity at half confidence (§8.1).
 */
const CALLING_CODES: Readonly<Record<string, string>> = {
  US: '1',
  CA: '1',
  GB: '44',
  DE: '49',
  FR: '33',
  NL: '31',
  ES: '34',
  IT: '39',
  PL: '48',
  UA: '380',
  RU: '7',
  IN: '91',
  AU: '61',
  BR: '55',
};

const phone: Normalizer = (raw, ctx) => {
  const digits = raw.replace(/[\s().\-\u2013\u2014]/g, '');
  if (/^\+\d{7,15}$/.test(digits)) {
    return ok(digits, raw.trim(), { e164: digits });
  }
  const region = (ctx?.defaultRegion ?? '').toUpperCase();
  const code = CALLING_CODES[region];
  if (code !== undefined) {
    const national = digits.replace(/^0+/, '');
    if (/^\d{6,14}$/.test(national)) {
      const e164 = `+${code}${national}`;
      if (e164.length <= 16) return ok(e164, raw.trim(), { e164, region, national });
    }
  }
  return fail('not a parseable phone number');
};

const repo: Normalizer = (raw) => {
  let value = raw.trim();
  if (value === '') return fail('not a repository reference');
  try {
    const parsed = new URL(value);
    value = `${parsed.hostname}${parsed.pathname}`;
  } catch {
    /* not a URL: treat as host/owner/name already */
  }
  value = value.replace(/^\/+/, '');
  value = value.replace(/\/(tree|blob|commit|releases|issues|pull)(\/.*)?$/i, '');
  value = value.replace(/\.git$/i, '');
  value = value.replace(/\/+$/, '');
  const parts = value.split('/').filter((part) => part !== '');
  if (parts.length !== 3) return fail('not in host/owner/name form');
  const [host = '', owner = '', name = ''] = parts;
  if (!/^[a-z0-9.-]+$/i.test(host) || owner === '' || name === '') {
    return fail('not in host/owner/name form');
  }
  return ok(`${host.toLowerCase()}/${owner}/${name}`, raw.trim(), {
    host: host.toLowerCase(),
    owner,
    name,
  });
};

/** Free-text kinds: trimmed and length-capped, never rejected for shape. */
const freeText =
  (maxLength: number): Normalizer =>
  (raw) => {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (trimmed === '') return fail('empty value');
    if (CONTROL_CHARS.test(trimmed)) return fail('contains control characters');
    return ok(trimmed.slice(0, maxLength).toLowerCase(), trimmed.slice(0, maxLength));
  };

export const normalizers: Readonly<Record<EntityKind, Normalizer>> = {
  domain,
  url,
  email,
  username,
  ip,
  hash,
  phone,
  handle,
  repo,
  person: freeText(200),
  organization: freeText(200),
  file: freeText(255),
  note: freeText(400),
  unknown: freeText(400),
};

/** The single entry point: every extracted value passes through here before it becomes identity. */
export function normalize(kind: EntityKind, raw: string, ctx?: NormalizeContext): NormalizeResult {
  const normalizer = normalizers[kind];
  return normalizer(raw, ctx);
}
