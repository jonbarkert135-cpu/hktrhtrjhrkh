/**
 * Rich text is stored as `Y.XmlFragment` and exported as ProseMirror JSON (08_DATA_MODEL.md §8.1):
 * portable, diffable and deterministically reconstructible into a fragment. P4 binds the editor to
 * the same fragments without a migration.
 */

import * as Y from 'yjs';
import { z } from 'zod';

export interface RichTextNodeJson {
  type: string;
  text?: string | undefined;
  attrs?: Record<string, unknown> | undefined;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> | undefined }> | undefined;
  content?: RichTextNodeJson[] | undefined;
}

export interface RichTextDocJson {
  encoding: 'prosemirror-json';
  doc: { type: 'doc'; content: RichTextNodeJson[] };
}

export const RichTextNodeJsonSchema: z.ZodType<RichTextNodeJson> = z.lazy(() =>
  z.object({
    type: z.string().min(1),
    text: z.string().optional(),
    attrs: z.record(z.unknown()).optional(),
    marks: z
      .array(z.object({ type: z.string().min(1), attrs: z.record(z.unknown()).optional() }))
      .optional(),
    content: z.array(RichTextNodeJsonSchema).optional(),
  }),
);

export const RichTextDocJsonSchema = z.object({
  encoding: z.literal('prosemirror-json'),
  doc: z.object({ type: z.literal('doc'), content: z.array(RichTextNodeJsonSchema) }),
});

interface Delta {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

/** Structural views of the Yjs XML types: `instanceof` narrows to `<any>` generics otherwise. */
interface XmlTextLike {
  toDelta(): Delta[];
}
interface XmlElementLike {
  nodeName: string;
  getAttributes(): Record<string, unknown>;
  toArray(): unknown[];
}

function textToJson(text: XmlTextLike): RichTextNodeJson[] {
  const deltas = text.toDelta();
  const out: RichTextNodeJson[] = [];
  for (const delta of deltas) {
    if (typeof delta.insert !== 'string') continue;
    const node: RichTextNodeJson = { type: 'text', text: delta.insert };
    const attributes = delta.attributes;
    if (attributes !== undefined) {
      node.marks = Object.keys(attributes)
        .sort()
        .map((type) => {
          const value = attributes[type];
          return value === true || value === null || value === undefined
            ? { type }
            : { type, attrs: value as Record<string, unknown> };
        });
    }
    out.push(node);
  }
  return out;
}

function elementToJson(element: XmlElementLike): RichTextNodeJson {
  const node: RichTextNodeJson = { type: element.nodeName };
  const attributes = element.getAttributes();
  const keys = Object.keys(attributes).sort();
  if (keys.length > 0) {
    const attrs: Record<string, unknown> = {};
    for (const key of keys) attrs[key] = attributes[key];
    node.attrs = attrs;
  }
  const content = childrenToJson(element.toArray());
  if (content.length > 0) node.content = content;
  return node;
}

function childrenToJson(children: readonly unknown[]): RichTextNodeJson[] {
  const out: RichTextNodeJson[] = [];
  for (const child of children) {
    if (child instanceof Y.XmlText) out.push(...textToJson(child));
    else if (child instanceof Y.XmlElement) out.push(elementToJson(child as XmlElementLike));
  }
  return out;
}

export function fragmentToJson(fragment: Y.XmlFragment): RichTextDocJson {
  return {
    encoding: 'prosemirror-json',
    doc: { type: 'doc', content: childrenToJson(fragment.toArray()) },
  };
}

function jsonToChild(node: RichTextNodeJson): Y.XmlElement | Y.XmlText {
  // Not a board node: this is a ProseMirror JSON node, whose `type` is part of the document format.
  // eslint-disable-next-line nexus/no-node-type-switch
  if (node.type === 'text') {
    const text = new Y.XmlText();
    const attributes: Record<string, unknown> = {};
    for (const mark of node.marks ?? []) attributes[mark.type] = mark.attrs ?? true;
    text.insert(0, node.text ?? '', node.marks === undefined ? undefined : attributes);
    return text;
  }
  const element = new Y.XmlElement(node.type);
  for (const key of Object.keys(node.attrs ?? {}).sort()) {
    const value = (node.attrs ?? {})[key];
    element.setAttribute(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const children = (node.content ?? []).map(jsonToChild);
  if (children.length > 0) element.insert(0, children);
  return element;
}

/** Rebuilds a fragment in place. The fragment must belong to a doc and be inside a transaction. */
export function applyJsonToFragment(fragment: Y.XmlFragment, json: RichTextDocJson): void {
  if (fragment.length > 0) fragment.delete(0, fragment.length);
  const children = json.doc.content.map(jsonToChild);
  if (children.length > 0) fragment.insert(0, children);
}

/* ------------------------------------------------------- plain-text projection */

/**
 * Node names that hold other blocks. They contribute no line of their own; their children do.
 * Anything not listed here and not inline is treated as a leaf block, so an unknown node from a
 * future schema still produces its text instead of disappearing.
 */
const CONTAINER_NODES: ReadonlySet<string> = new Set([
  'blockquote',
  'bulletList',
  'bullet_list',
  'orderedList',
  'ordered_list',
  'taskList',
  'task_list',
  'listItem',
  'list_item',
  'taskItem',
  'task_item',
]);

/** Nodes that carry no readable text at all. */
const VOID_NODES: ReadonlySet<string> = new Set(['horizontalRule', 'horizontal_rule', 'image']);

const isTaskItem = (type: string): boolean => type === 'taskItem' || type === 'task_item';

/** Concatenates every text descendant of an inline subtree, marks included, order preserved. */
function inlineText(nodes: readonly RichTextNodeJson[]): string {
  let out = '';
  for (const node of nodes) {
    // ProseMirror JSON node names, not board node types — the lint rule targets the latter.
    // eslint-disable-next-line nexus/no-node-type-switch
    if (node.type === 'text') out += node.text ?? '';
    else if (!VOID_NODES.has(node.type)) out += inlineText(node.content ?? []);
  }
  return out;
}

function blockLines(node: RichTextNodeJson): string[] {
  if (VOID_NODES.has(node.type)) return [];
  if (CONTAINER_NODES.has(node.type)) {
    const lines = (node.content ?? []).flatMap(blockLines);
    if (!isTaskItem(node.type)) return lines;
    const checked = node.attrs?.['checked'];
    const marker = checked === true || checked === 'true' ? '[x] ' : '[ ] ';
    return lines.length === 0
      ? [marker.trimEnd()]
      : [`${marker}${lines[0] ?? ''}`, ...lines.slice(1)];
  }
  // A bare text node at block level is its own line; ProseMirror JSON names, not board types.
  // eslint-disable-next-line nexus/no-node-type-switch
  const isBareText = node.type === 'text';
  return [inlineText(isBareText ? [node] : (node.content ?? []))];
}

/**
 * Deterministic plain-text view of a rich-text document (P4 §7): one line per block, task markers
 * preserved, no trailing whitespace. It feeds `data.plain` (card preview, L1 painter) and the P7
 * search index, so two identical documents must always produce the same string.
 */
export function richTextToPlainText(json: RichTextDocJson): string {
  return json.doc.content
    .flatMap(blockLines)
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Size of the document as it is stored, in bytes. The editor's guard rail (`richTextSizeIssue`)
 * compares against this number, so the warning the user sees matches what persistence carries.
 */
export function richTextByteSize(json: RichTextDocJson): number {
  return new TextEncoder().encode(JSON.stringify(json)).length;
}

/** Convenience for callers holding a fragment: JSON, plain text and byte size in one pass. */
export function richTextProjection(fragment: Y.XmlFragment): {
  json: RichTextDocJson;
  plain: string;
  bytes: number;
} {
  const json = fragmentToJson(fragment);
  return { json, plain: richTextToPlainText(json), bytes: richTextByteSize(json) };
}
