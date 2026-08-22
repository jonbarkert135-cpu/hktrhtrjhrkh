/**
 * The worker protocol. Structured-clonable plain objects only, and validated on the way in: the
 * worker is a boundary, so it gets the same zod treatment as any other (`15_SECURITY.md` §4).
 */

import { LAYOUT_ALGORITHMS, type LayoutDiff, type LayoutGraph } from '@nexus/layout';
import { z } from 'zod';

export const LayoutNodeMessageSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite(),
  h: z.number().finite(),
  pinned: z.boolean().optional(),
  observedAt: z.string().nullable().optional(),
  group: z.string().nullable().optional(),
});

export const LayoutRequestSchema = z.object({
  runId: z.number().int().nonnegative(),
  algorithm: z.enum(LAYOUT_ALGORITHMS),
  seed: z.number().int().optional(),
  spacingX: z.number().finite().positive().optional(),
  spacingY: z.number().finite().positive().optional(),
  direction: z.enum(['down', 'up', 'right', 'left']).optional(),
  iterations: z.number().int().min(1).max(2000).optional(),
  graph: z.object({
    nodes: z.array(LayoutNodeMessageSchema),
    edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() })),
  }),
});

export type LayoutRequestMessage = z.infer<typeof LayoutRequestSchema>;

export type LayoutWorkerCommand =
  | { readonly kind: 'run'; readonly request: LayoutRequestMessage }
  | { readonly kind: 'cancel'; readonly runId: number };

export type LayoutWorkerEvent =
  | { readonly kind: 'progress'; readonly runId: number; readonly fraction: number }
  | { readonly kind: 'done'; readonly runId: number; readonly diff: LayoutDiff }
  | { readonly kind: 'cancelled'; readonly runId: number }
  | { readonly kind: 'error'; readonly runId: number; readonly message: string };

/** Strips the graph down to what the protocol allows, so nothing exotic crosses the boundary. */
export function toRequestGraph(graph: LayoutGraph): LayoutRequestMessage['graph'] {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      pinned: node.pinned === true,
      observedAt: node.observedAt ?? null,
      group: node.group ?? null,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
  };
}
