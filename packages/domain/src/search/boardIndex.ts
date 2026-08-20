/**
 * Bridges a board document to the local search index (P7 §5). Each node type already declares
 * `searchFields()` (06_NODE_SYSTEM.md); this is the one place that turns "every node in a doc"
 * into the `IndexedDoc[]` the index wants, so `apps/web` never has to know the node registry API.
 */

import type * as Y from 'yjs';

import { listNodes } from '../doc/mutations.ts';
import { builtinNodeTypes } from '../nodes/builtins.ts';
import type { NodeTypeRegistry } from '../nodes/registry.ts';
import type { IndexedDoc } from './localIndex.ts';

/** One `IndexedDoc` per node in `doc`, tagged with `boardId` for cross-board grouping (P7 §7). */
export function indexedDocsForBoard(
  doc: Y.Doc,
  boardId: string,
  registry: NodeTypeRegistry = builtinNodeTypes(),
): IndexedDoc[] {
  const out: IndexedDoc[] = [];
  for (const node of listNodes(doc)) {
    const def = registry.get(node.type);
    const fields = def.searchFields(node);
    out.push({
      id: node.id,
      boardId,
      title: fields.title,
      body: fields.body,
      keywords: fields.keywords,
    });
  }
  return out;
}
