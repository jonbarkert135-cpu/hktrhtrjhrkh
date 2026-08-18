/**
 * Node lifecycle (P4 §5.10): create → update → duplicate → convert → delete, each one transaction
 * and therefore one undo step. Every function here goes through `doc/mutations.ts`; nothing in this
 * file touches a `Y.Map` directly.
 */

import type * as Y from 'yjs';

import { addNode, ensureFragment, getNode, removeNodes, updateNode } from '../doc/mutations.ts';
import type { Origin } from '../doc/transactions.ts';
import { makeNode, type BoardNode } from '../entities/node.ts';
import { newId } from '../ids.ts';
import type { Provenance } from '../entities/provenance.ts';
import { builtinNodeTypes } from './builtins.ts';
import { normalizeTags, type TagRejection } from './tags.ts';
import type { TypedNode } from './types.ts';

export interface LifecycleOptions {
  now: string;
  origin?: Origin | undefined;
  makeId?: (() => string) | undefined;
  actorId?: string | null | undefined;
}

const mintId = (options: LifecycleOptions): string =>
  (options.makeId ?? ((): string => newId.board()))();

/** `<nodeId>:body` — one fragment per node, derivable from the id so restore never has to guess. */
export function bodyFragmentKey(nodeId: string): string {
  return `${nodeId}:body`;
}

export interface CreateNodeInput {
  type: string;
  x: number;
  y: number;
  w?: number | undefined;
  h?: number | undefined;
  title?: string | undefined;
  tags?: readonly string[] | undefined;
  data?: Record<string, unknown> | undefined;
  provenance?: Partial<Provenance> | undefined;
}

export interface CreatedNode {
  node: BoardNode;
  rejectedTags: TagRejection[];
}

/**
 * Creates a node of `input.type`, filling the registry defaults for size and payload. An unknown
 * type is not rejected: it is stored as-is and the `unknown` definition renders it (forward compat).
 */
export function createNode(
  doc: Y.Doc,
  input: CreateNodeInput,
  options: LifecycleOptions,
): CreatedNode {
  const def = builtinNodeTypes().get(input.type);
  const id = mintId(options);
  const parsedData = def.schema.parse({
    ...(def.defaults.data as Record<string, unknown>),
    ...(input.data ?? {}),
  }) as Record<string, unknown>;

  if (def.capabilities.editableText && parsedData['fragmentKey'] === '') {
    parsedData['fragmentKey'] = bodyFragmentKey(id);
  }

  const { tags, rejected } = normalizeTags(input.tags ?? []);
  const origin = options.origin ?? 'local:create';

  const node = makeNode(
    {
      id,
      type: input.type,
      x: input.x,
      y: input.y,
      w: input.w ?? def.defaults.size.w,
      h: input.h ?? def.defaults.size.h,
      title: input.title ?? '',
      tags,
      data: parsedData,
      provenance: {
        kind: 'manual',
        source: null,
        tool: null,
        observedAt: options.now,
        importedAt: options.now,
        actorId: options.actorId ?? null,
        ...(input.provenance ?? {}),
      },
    },
    options.now,
  );

  addNode(doc, node, { origin, now: options.now });
  if (def.capabilities.editableText) {
    ensureFragment(doc, bodyFragmentKey(id), origin);
  }
  return { node, rejectedTags: rejected };
}

/** Merges a patch into `data`, validated by the type's schema. Unknown keys survive. */
export function updateNodeData(
  doc: Y.Doc,
  id: string,
  patch: Record<string, unknown>,
  options: LifecycleOptions,
): boolean {
  const node = getNode(doc, id);
  if (node === undefined) return false;
  const def = builtinNodeTypes().get(node.type);
  const merged = def.schema.parse({ ...node.data, ...patch }) as Record<string, unknown>;
  return updateNode(
    doc,
    id,
    { data: merged },
    { origin: options.origin ?? 'local:edit', now: options.now },
  );
}

/** Replaces the tag set, normalised. Returns the tags that were refused and why. */
export function setNodeTags(
  doc: Y.Doc,
  id: string,
  values: readonly string[],
  options: LifecycleOptions,
): { applied: boolean; tags: string[]; rejected: TagRejection[] } {
  const { tags, rejected } = normalizeTags(values);
  const applied = updateNode(
    doc,
    id,
    { tags },
    { origin: options.origin ?? 'local:edit', now: options.now },
  );
  return { applied, tags, rejected };
}

export const DUPLICATE_OFFSET = 24;

/**
 * Copies a node 24 px down-right with a new id and `derivedFrom` provenance. The rich-text body is
 * copied as a *new* fragment: sharing one fragment between two nodes would make editing either of
 * them edit both.
 */
export function duplicateNode(
  doc: Y.Doc,
  id: string,
  options: LifecycleOptions,
): BoardNode | undefined {
  const source = getNode(doc, id);
  if (source === undefined) return undefined;
  const def = builtinNodeTypes().get(source.type);
  if (!def.capabilities.duplicatable) return undefined;

  const newNodeId = mintId(options);
  const origin = options.origin ?? 'local:create';
  const data: Record<string, unknown> = { ...source.data };
  if (def.capabilities.editableText) data['fragmentKey'] = bodyFragmentKey(newNodeId);

  const copy = makeNode(
    {
      id: newNodeId,
      type: source.type,
      x: source.x + DUPLICATE_OFFSET,
      y: source.y + DUPLICATE_OFFSET,
      w: source.w,
      h: source.h,
      title: source.title,
      tags: [...source.tags],
      data,
      provenance: {
        ...source.provenance,
        kind: 'manual',
        derivedFrom: source.id,
        importedAt: options.now,
        actorId: options.actorId ?? null,
      },
    },
    options.now,
  );

  addNode(doc, copy, { origin, now: options.now });
  if (def.capabilities.editableText) ensureFragment(doc, bodyFragmentKey(newNodeId), origin);
  return copy;
}

export function deleteNode(doc: Y.Doc, id: string, options: LifecycleOptions): boolean {
  if (getNode(doc, id) === undefined) return false;
  removeNodes(doc, [id], { origin: options.origin ?? 'local:delete', now: options.now });
  return true;
}

export interface ConversionPlan {
  from: string;
  to: string;
  /** Payload keys the target type cannot hold; the UI must confirm before the data is dropped. */
  droppedKeys: string[];
  data: Record<string, unknown>;
}

/**
 * Plans a type conversion without performing it, so the UI can show exactly what would be lost
 * ("Converting to Link discards the fetched description"). Nothing is written here.
 */
export function planConversion(
  node: TypedNode<Record<string, unknown>>,
  toType: string,
): ConversionPlan {
  const target = builtinNodeTypes().get(toType);
  const defaults = target.defaults.data as Record<string, unknown>;
  const carried: Record<string, unknown> = { ...defaults };
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(node.data)) {
    if (key in defaults) carried[key] = value;
    else if (value !== null && value !== '' && value !== undefined) dropped.push(key);
  }
  return { from: node.type, to: toType, droppedKeys: dropped.sort(), data: carried };
}

/**
 * Converts a node in place: the id, edges, tags and provenance survive, only `type` and `data`
 * change (06 §11). Callers confirm `planConversion().droppedKeys` with the user first.
 */
export function convertNode(
  doc: Y.Doc,
  id: string,
  toType: string,
  options: LifecycleOptions,
): boolean {
  const node = getNode(doc, id);
  if (node === undefined) return false;
  const target = builtinNodeTypes().get(toType);
  const plan = planConversion(node, toType);
  const data = target.schema.parse(plan.data) as Record<string, unknown>;
  if (target.capabilities.editableText && data['fragmentKey'] === '') {
    data['fragmentKey'] = bodyFragmentKey(id);
  }
  const origin = options.origin ?? 'local:edit';
  const changed = updateNode(doc, id, { type: toType, data }, { origin, now: options.now });
  if (changed && target.capabilities.editableText) ensureFragment(doc, bodyFragmentKey(id), origin);
  return changed;
}
