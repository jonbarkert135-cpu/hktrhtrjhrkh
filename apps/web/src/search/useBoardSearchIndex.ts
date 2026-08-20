/**
 * Maintains a `LocalIndex` for the open board, incrementally, from `observeBoard` change batches
 * (P7 §5/§7). The initial build is chunked so it never blocks the frame path for more than a few
 * milliseconds at a time (N1) — large boards fill in over a few idle callbacks instead of one long
 * synchronous pass.
 */

import {
  builtinNodeTypes,
  createLocalIndex,
  getNode,
  listNodes,
  observeBoard,
} from '@nexus/domain';
import type { LocalIndex } from '@nexus/domain';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

/** Nodes indexed per idle chunk during the initial build — small enough to stay under ~4 ms. */
const CHUNK_SIZE = 250;

type IdleWindow = typeof window & {
  requestIdleCallback?: (cb: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleIdle(cb: () => void): () => void {
  const win: IdleWindow = window;
  if (typeof win.requestIdleCallback === 'function') {
    const handle = win.requestIdleCallback(cb);
    return () => win.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(cb, 0);
  return () => window.clearTimeout(handle);
}

export function useBoardSearchIndex(doc: Y.Doc, boardId: string): LocalIndex {
  const [index] = useState(() => createLocalIndex());

  useEffect(() => {
    index.clear();
    const registry = builtinNodeTypes();
    const nodes = listNodes(doc);
    let cursor = 0;
    let cancelled = false;
    let cancelIdle = () => undefined as void;

    const upsertOne = (node: (typeof nodes)[number]): void => {
      const fields = registry.get(node.type).searchFields(node);
      index.upsert({
        id: node.id,
        boardId,
        title: fields.title,
        body: fields.body,
        keywords: fields.keywords,
      });
    };

    const runChunk = (): void => {
      if (cancelled) return;
      const end = Math.min(cursor + CHUNK_SIZE, nodes.length);
      for (; cursor < end; cursor += 1) {
        const node = nodes[cursor];
        if (node !== undefined) upsertOne(node);
      }
      if (cursor < nodes.length) cancelIdle = scheduleIdle(runChunk);
    };
    runChunk();

    const unsubscribe = observeBoard(doc, (change) => {
      const registryNow = builtinNodeTypes();
      for (const id of change.nodes.removed) index.remove(id);
      for (const id of change.nodes.upserted) {
        const node = getNode(doc, id);
        if (node === undefined) continue;
        const fields = registryNow.get(node.type).searchFields(node);
        index.upsert({
          id: node.id,
          boardId,
          title: fields.title,
          body: fields.body,
          keywords: fields.keywords,
        });
      }
    });

    return () => {
      cancelled = true;
      cancelIdle();
      unsubscribe();
    };
  }, [doc, boardId, index]);

  return index;
}
