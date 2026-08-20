/**
 * The run-history slice of the workspace repository (P9 §4, ADR-002 `integrations`).
 *
 * Tool execution is server-side by definition (N5: a sandboxed runner, never in-process), so unlike
 * projects and boards this slice has no local implementation — and pretending otherwise would be
 * worse than not having it. In `APP_MODE=local` the whole integrations surface is *absent*, not
 * disabled; `localRuns()` exists only so an accidental call is a loud, named failure that
 * `app/localMode.test.tsx` catches, rather than a silent no-op that ships.
 */

import { WorkspaceError } from './types.ts';

export interface WorkspaceRun {
  id: string;
  integrationId: string;
  boardId: string;
  actorUserId: string;
  status: string;
  durationMs: number | null;
  proposalId: string | null;
  createdAt: string;
}

export interface ListRunsOptions {
  boardId?: string;
  projectId?: string;
  integrationId?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface StartRunInput {
  integrationId: string;
  projectId: string;
  boardId: string;
  anchorNodeId?: string;
  input: Record<string, unknown>;
  targets: {
    kind: string;
    value: string;
    scope: 'public-index' | 'owned-asset' | 'third-party-host';
  }[];
  consentToken: string;
  force?: boolean;
  parentRunId?: string;
}

export interface RunsRepository {
  readonly kind: 'local' | 'server';
  listRuns: (options?: ListRunsOptions) => Promise<{ runs: WorkspaceRun[]; nextCursor?: string }>;
  startRun: (
    input: StartRunInput,
  ) => Promise<{ runId: string; reused: boolean; notice: string | null }>;
  cancelRun: (input: { runId: string }) => Promise<{ status: string; cancelled: boolean }>;
  getRunLog: (input: {
    runId: string;
  }) => Promise<{ seq: number; at: string; level: string; phase: string; message: string }[]>;
}

export const LOCAL_RUNS_MESSAGE =
  'Integrations need a Raven server: tools run in a sandbox, never in your browser. Sign in to a deployment to use them.';

/** Every method throws. That is the contract, not a gap (N2). */
export function localRuns(): RunsRepository {
  const refuse = (): never => {
    throw new WorkspaceError(LOCAL_RUNS_MESSAGE);
  };
  return {
    kind: 'local',
    listRuns: () => Promise.resolve(refuse()),
    startRun: () => Promise.resolve(refuse()),
    cancelRun: () => Promise.resolve(refuse()),
    getRunLog: () => Promise.resolve(refuse()),
  };
}
