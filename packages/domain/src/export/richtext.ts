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
