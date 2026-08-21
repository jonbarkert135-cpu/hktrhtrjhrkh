/**
 * The run-history slice of the workspace repository (P9 §4, ADR-002 `integrations`).
 *
 * Tool execution is server-side by definition (N5: a sandboxed runner, never in-process), so unlike
 * projects and boards this slice has no local implementation — and pretending otherwise would be
 * worse than not having it. In `APP_MODE=local` the whole integrations surface is *absent*, not
 * disabled; `localRuns()` exists only so an accidental call is a loud, named failure that
 * `app/localMode.test.tsx` catches, rather than a silent no-op that ships.
 */

import {
  WorkspaceError,
  type AcceptConsentInput,
  type ListRunsOptions,
  type RunsRepository,
  type StartRunInput,
  type WorkspaceRun,
} from './types.ts';

export type {
  AcceptConsentInput,
  ListRunsOptions,
  RunsRepository,
  StartRunInput,
  WorkspaceRun,
} from './types.ts';

export const LOCAL_RUNS_MESSAGE =
  'Integrations need a Raven server: tools run in a sandbox, never in your browser. Sign in to a deployment to use them.';

/** Every method throws. That is the contract, not a gap (N2). */
export function localRuns(): RunsRepository {
  const refuse = (): never => {
    throw new WorkspaceError(LOCAL_RUNS_MESSAGE);
  };
  return {
    kind: 'local',
    acceptConsent: () => Promise.resolve(refuse()),
    getProposal: () => Promise.resolve(refuse()),
    listRuns: () => Promise.resolve(refuse()),
    startRun: () => Promise.resolve(refuse()),
    cancelRun: () => Promise.resolve(refuse()),
    getRunLog: () => Promise.resolve(refuse()),
  };
}

/** The calls `createServerRuns` needs; injected so tests never touch tRPC (see `server.ts`). */
export interface RunsApi {
  acceptConsent: (input: AcceptConsentInput) => Promise<{ consentToken: string }>;
  getProposal: (input: { proposalId: string }) => Promise<unknown>;
  listRuns: (input: ListRunsOptions) => Promise<{ runs: WorkspaceRun[]; nextCursor?: string }>;
  startRun: RunsRepository['startRun'];
  cancelRun: RunsRepository['cancelRun'];
  getRunLog: RunsRepository['getRunLog'];
}

/** Server mode: a thin pass-through — the router already speaks the shapes the UI wants. */
export function createServerRuns(api: RunsApi): RunsRepository {
  return {
    kind: 'server',
    acceptConsent: (input) => api.acceptConsent(input),
    getProposal: (input) => api.getProposal(input),
    listRuns: (options = {}) => api.listRuns(options),
    startRun: (input) => api.startRun(input),
    cancelRun: (input) => api.cancelRun(input),
    getRunLog: (input) => api.getRunLog(input),
  };
}
