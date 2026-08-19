/**
 * URL validation for every user-supplied URL (00_MASTER.md N7, 15_SECURITY.md §4). Pure, so the
 * SSRF corpus (18_TESTING.md §11.1) runs without a network: `safeFetch` calls this before it
 * resolves anything, and again at every redirect hop.
 *
 * Rejections are codes, never booleans — the UI turns the code into the sentence the analyst reads.
 */

export const URL_ERROR_CODES = [
  'url_malformed',
  'scheme_not_allowed',
  'port_not_allowed',
  'userinfo_not_allowed',
  'host_missing',
  'host_mixed_script',
  'encoding_not_normalized',
  'address_blocked',
  'dns_failed',
  'too_many_redirects',
  'timeout',
  'body_too_large',
  'content_type_not_allowed',
  'http_error',
] as const;

export type UrlErrorCode = (typeof URL_ERROR_CODES)[number];

/** What the analyst is told. One sentence: what happened, why, what to do (03_UX.md §12). */
export const URL_ERROR_MESSAGES: Readonly<Record<UrlErrorCode, string>> = {
  url_malformed: "That doesn't look like a web address — check for typos and try again.",
  scheme_not_allowed: 'Only http and https addresses can be fetched.',
  port_not_allowed: 'That port is not allowed. Use the standard 80, 443, 8080 or 8443.',
  userinfo_not_allowed: 'Addresses with a username or password in them are not fetched.',
  host_missing: 'That address has no host name.',
  host_mixed_script: 'This host name mixes alphabets, which is a common spoofing trick.',
  encoding_not_normalized: 'That address is encoded in a non-standard way — paste the plain URL.',
  address_blocked: 'This address is not reachable from the server (private network).',
  dns_failed: "This host name doesn't resolve — check the spelling or your connection.",
  too_many_redirects: 'The page redirected too many times.',
  timeout: 'The site took too long to answer. Retry, or open it in a browser tab.',
  body_too_large: 'The page is too large to read.',
  content_type_not_allowed: 'That address does not return a web page.',
  http_error: "Couldn't fetch this page — the site blocked the request.",
};

export class UrlRejected extends Error {
  readonly code: UrlErrorCode;
  constructor(code: UrlErrorCode, detail?: string) {
    super(
      detail === undefined ? URL_ERROR_MESSAGES[code] : `${URL_ERROR_MESSAGES[code]} ${detail}`,
    );
    this.name = 'UrlRejected';
    this.code = code;
  }
}

export const ALLOWED_SCHEMES: readonly string[] = ['http:', 'https:'];
export const ALLOWED_PORTS: readonly number[] = [80, 443, 8080, 8443];
/** Metadata is read from a page, never from a download (15_SECURITY.md §4). */
export const ALLOWED_CONTENT_TYPES: readonly string[] = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
];

const LATIN = /^[\p{Script=Latin}\p{Nd}\-_]+$/u;
const NON_LATIN_SCRIPT = /[^\p{Script=Common}\p{Script=Inherited}\p{Script=Latin}]/u;

/**
 * A label is fine if it is pure ASCII/Latin, or written entirely in one non-Latin script. Mixing
 * scripts inside one label is the homograph attack (`аpple.com` with a Cyrillic а), so it is out.
 */
function labelIsSingleScript(label: string): boolean {
  if (LATIN.test(label)) return true;
  return !(NON_LATIN_SCRIPT.test(label) && /\p{Script=Latin}/u.test(label));
}

export interface ValidatedUrl {
  /** The URL to fetch, punycoded and normalized. */
  readonly url: URL;
  /** Lowercased punycode host. */
  readonly hostname: string;
  readonly port: number;
}

/**
 * Validates scheme, port, authority and host spelling. Does not touch DNS — that is `dnsPin.ts`,
 * because resolution is the only part that needs an environment.
 */
export function validateUrl(input: string | URL): ValidatedUrl {
  let url: URL;
  try {
    url = new URL(typeof input === 'string' ? input : input.href);
  } catch {
    throw new UrlRejected('url_malformed');
  }

  if (!ALLOWED_SCHEMES.includes(url.protocol)) throw new UrlRejected('scheme_not_allowed');
  if (url.username !== '' || url.password !== '') throw new UrlRejected('userinfo_not_allowed');
  if (url.hostname === '') throw new UrlRejected('host_missing');

  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!ALLOWED_PORTS.includes(port)) throw new UrlRejected('port_not_allowed');

  // `new URL()` already punycodes; a host that still carries non-ASCII is a bracketed IPv6 literal
  // or a spoofing attempt, so it is checked label by label against the source spelling.
  const source = typeof input === 'string' ? input : input.href;
  for (const label of hostLabels(source)) {
    if (!labelIsSingleScript(label)) throw new UrlRejected('host_mixed_script');
  }

  // Checked against the *source* spelling: `new URL()` already folds `%2e%2e` away, and a path
  // that hides its real target behind an encoding must be refused, not silently normalized.
  if (isDoubleEncoded(source)) {
    throw new UrlRejected('encoding_not_normalized');
  }

  return { url, hostname: url.hostname.toLowerCase(), port };
}

function hostLabels(source: string): string[] {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(source);
  const authority = match?.[1] ?? '';
  const host = authority.split('@').pop() ?? '';
  if (host.startsWith('[')) return [];
  return host.split('.').filter((label) => label !== '');
}

function isDoubleEncoded(part: string): boolean {
  if (!part.includes('%')) return false;
  try {
    return /%25|%2e%2e|%2f/i.test(part);
  } catch {
    return true;
  }
}

/**
 * Cache key for the unfurl cache (§5.8): scheme + host + port + path + sorted query, without the
 * fragment and without tracking parameters, so two spellings of one page share a cache entry.
 */
export function normalizeUrl(input: string | URL): string {
  const { url } = validateUrl(input);
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !/^(utm_|fbclid$|gclid$|ref$|ref_src$)/i.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(params).toString();
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const port = url.port === '' ? '' : `:${url.port}`;
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}${query === '' ? '' : `?${query}`}`;
}
