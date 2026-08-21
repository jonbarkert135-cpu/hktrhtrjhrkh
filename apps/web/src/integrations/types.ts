/**
 * What the integration UI needs to know about a tool (10_INTEGRATIONS.md §7).
 *
 * A structural subset of `integrations.list`'s DTO, declared here rather than imported so the
 * components stay renderable from a fixture — and so nothing in the UI depends on the manifest
 * schema's optional corners.
 */

export interface IntegrationSummary {
  id: string;
  name: string;
  description: string;
  executionKind: 'container' | 'http' | 'builtin';
  /** Which entity kinds its `selection`-sourced inputs accept; empty means "anything". */
  acceptsKinds: readonly string[];
  /** Enough of `manifest.inputs` to fill the form from the selection, and no more. */
  inputs: readonly { name: string; fromSelection: boolean; required: boolean }[];
  consent: { required: boolean; scopeText: string };
  risk: { label: 'low' | 'medium' | 'high'; reasons: readonly string[] };
}

/** The seven run states of §7.2, as the run surface sees them. */
export type RunUiState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'parsing'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface RunRow {
  id: string;
  integrationId: string;
  boardId: string;
  actorUserId: string;
  status: string;
  durationMs: number | null;
  proposalId: string | null;
  createdAt: string;
}
