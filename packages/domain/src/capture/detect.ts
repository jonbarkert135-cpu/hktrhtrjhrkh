/**
 * Paste/drop detection (P6 §5.1). A pure function over a snapshot of a `DataTransfer`: the React
 * hooks take the snapshot, this decides, and `plan.ts` turns the decision into nodes. Detection
 * order is fixed and first-match-wins, so the same clipboard always produces the same node types.
 *
 *   files → image → text/html → text/uri-list → plain text that parses as URLs → plain text → none
 */

import {
  MAX_PASTE_URLS,
  extractUrls,
  htmlToPlainText,
  urlsFromHtml,
  urlsFromUriList,
} from './parse.ts';

export interface TransferFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

/** Everything the detector may look at. Taken from a `DataTransfer` by the hook, never here. */
export interface TransferSnapshot {
  readonly files?: readonly TransferFile[] | undefined;
  readonly html?: string | undefined;
  readonly uriList?: string | undefined;
  readonly text?: string | undefined;
}

export type CaptureDetection =
  | { kind: 'image'; files: readonly TransferFile[]; caption: string | null }
  | { kind: 'files'; files: readonly TransferFile[] }
  | { kind: 'urls'; urls: readonly string[]; total: number; truncated: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'none'; reason: string };

const isImage = (file: TransferFile): boolean => file.type.startsWith('image/');

const urlsDetection = (urls: readonly string[]): CaptureDetection => ({
  kind: 'urls',
  urls: urls.slice(0, MAX_PASTE_URLS),
  total: urls.length,
  truncated: urls.length > MAX_PASTE_URLS,
});

export function detectTransfer(snapshot: TransferSnapshot): CaptureDetection {
  const files = snapshot.files ?? [];
  const text = (snapshot.text ?? '').trim();

  if (files.length > 0) {
    // An image plus text (a paste out of a document) is an image; the text becomes the caption (§8).
    const images = files.filter(isImage);
    if (images.length > 0 && images.length === files.length) {
      return { kind: 'image', files: images, caption: text === '' ? null : text };
    }
    return { kind: 'files', files };
  }

  const html = snapshot.html ?? '';
  if (html.trim() !== '') {
    const urls = urlsFromHtml(html);
    if (urls.length > 0) return urlsDetection(urls);
    const plain = htmlToPlainText(html);
    if (plain !== '') return { kind: 'text', text: plain };
  }

  const uriList = urlsFromUriList(snapshot.uriList ?? '');
  if (uriList.length > 0) return urlsDetection(uriList);

  if (text !== '') {
    const urls = extractUrls(text);
    // "Here is a link: https://x" is text with a link in it, not a link paste; only a text made of
    // URLs (and whitespace) becomes link nodes.
    const remainder = urls.reduce((rest, url) => rest.split(url).join(' '), text).trim();
    if (urls.length > 0 && remainder === '') return urlsDetection(urls);
    return { kind: 'text', text };
  }

  return { kind: 'none', reason: 'Nothing to paste' };
}
