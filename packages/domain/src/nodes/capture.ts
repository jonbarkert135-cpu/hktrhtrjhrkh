/**
 * Capture routing (06_NODE_SYSTEM.md §7.1): given a pasted or dropped payload, every type scores
 * itself and the highest score wins. Ties are broken by registration order, so the result is
 * deterministic — a paste must always produce the same node type for the same input.
 */

import { UNKNOWN_NODE_TYPE } from '../entities/node.ts';
import { nodeTypes, type NodeTypeRegistry } from './registry.ts';
import type { CaptureInput } from './types.ts';

export interface CaptureDecision {
  type: string;
  score: number;
  title: string;
  data: Record<string, unknown>;
}

/** Fallback when nothing matches: the payload becomes a text note rather than being dropped. */
const FALLBACK_TYPE = 'text';

export function decideCapture(
  input: CaptureInput,
  registry: NodeTypeRegistry = nodeTypes,
): CaptureDecision {
  let best: { type: string; score: number } | undefined;
  for (const def of registry.list()) {
    const score = def.capture?.match(input) ?? 0;
    if (score <= 0) continue;
    if (best === undefined || score > best.score) best = { type: def.type, score };
  }

  const chosen = best?.type ?? (registry.has(FALLBACK_TYPE) ? FALLBACK_TYPE : UNKNOWN_NODE_TYPE);
  const def = registry.get(chosen);
  const built = def.capture?.build(input);
  return {
    type: chosen,
    score: best?.score ?? 0,
    title: built?.title ?? (input.filename ?? input.text ?? '').slice(0, 96),
    data: built?.data ?? {},
  };
}
