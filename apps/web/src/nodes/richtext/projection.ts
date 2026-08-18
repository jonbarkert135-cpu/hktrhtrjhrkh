/**
 * Keeping `data.plain` in step with the fragment (P4 §7). The fragment is the content; `plain` is a
 * projection used by the card preview, by the L1 canvas painter and (from P7) by the search index.
 * It is written from one place only, so the two can never describe different notes.
 */

import {
  PLAIN_TEXT_MAX_CHARS,
  richTextProjection,
  richTextSizeIssue,
  updateNodeData,
  type RichTextSizeIssue,
} from '@nexus/domain';
import type * as Y from 'yjs';

export interface CommitResult {
  /** True when `data.plain` actually changed — the caller can skip a re-render otherwise. */
  written: boolean;
  plain: string;
  bytes: number;
  issue: RichTextSizeIssue | null;
}

/**
 * Writes the plain-text projection of `fragment` onto the node, and reports the size guard.
 * The write is skipped when nothing changed, so an editor that only moved the caret does not
 * produce a document transaction (and therefore no undo step and no sync traffic).
 */
export function commitRichText(
  doc: Y.Doc,
  nodeId: string,
  fragment: Y.XmlFragment,
  options: { now: string; currentPlain: string },
): CommitResult {
  const { plain, bytes } = richTextProjection(fragment);
  const clamped = plain.slice(0, PLAIN_TEXT_MAX_CHARS);
  const issue = richTextSizeIssue(bytes);
  if (clamped === options.currentPlain) {
    return { written: false, plain: clamped, bytes, issue };
  }
  const written = updateNodeData(doc, nodeId, { plain: clamped }, { now: options.now });
  return { written, plain: clamped, bytes, issue };
}
