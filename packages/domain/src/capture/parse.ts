/**
 * Text → URLs (P6 §5.2, §5.3). Pure string work, shared by paste, drop and the quick-add field, so
 * the three cannot disagree about what counts as a link.
 */

/** Above this many URLs in one paste the user is offered "Import as a list" instead (§8). */
export const MAX_PASTE_URLS = 50;
/** Shorter than this becomes a `text` node, longer a `note` (§5.3). */
export const TEXT_NODE_MAX_CHARS = 280;

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>()]+[^\s"'<>().,;:!?]/gi;

/** Extracts http(s) URLs in order of appearance, de-duplicated, trailing punctuation trimmed. */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = match[0];
    if (!seen.has(candidate)) seen.add(candidate);
  }
  return [...seen];
}

/** True when the whole string is one URL and nothing else — the "pasted a link" case. */
export function isSingleUrl(text: string): boolean {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return false;
  const urls = extractUrls(trimmed);
  return urls.length === 1 && urls[0] === trimmed;
}

/** `href` attributes first (a rich paste), then any bare URLs in the markup. */
export function urlsFromHtml(html: string): string[] {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1] ?? '')
    .filter((value) => /^https?:\/\//i.test(value));
  return [...new Set([...hrefs, ...extractUrls(html)])];
}

/** `text/uri-list` per RFC 2483: one URL per line, `#` lines are comments. */
export function urlsFromUriList(list: string): string[] {
  return [
    ...new Set(
      list
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#') && /^https?:\/\//i.test(line)),
    ),
  ];
}

const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
};

/** Strips tags and collapses whitespace — HTML is never trusted as markup (§9). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(nbsp|amp|lt|gt|quot|#39);/gi,
      (_m, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? _m,
    )
    .replace(/\s+/g, ' ')
    .trim();
}
