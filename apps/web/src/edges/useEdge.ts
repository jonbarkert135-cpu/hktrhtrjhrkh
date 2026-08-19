/**
 * Live read of one relationship (P5 §5.11). Edges change far less often than nodes, so they get a
 * plain document observer instead of the per-id node store: the panel re-reads only when the
 * observed change actually touched this edge.
 */

import { getEdge, observeBoard, type BoardEdge } from '@nexus/domain';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

export function useEdge(doc: Y.Doc, id: string | undefined): BoardEdge | undefined {
  const [edge, setEdge] = useState<BoardEdge | undefined>(() =>
    id === undefined ? undefined : getEdge(doc, id),
  );

  useEffect(() => {
    if (id === undefined) {
      setEdge(undefined);
      return undefined;
    }
    setEdge(getEdge(doc, id));
    return observeBoard(doc, (change) => {
      if (!change.edges.upserted.includes(id) && !change.edges.removed.includes(id)) return;
      setEdge(getEdge(doc, id));
    });
  }, [doc, id]);

  return edge;
}
