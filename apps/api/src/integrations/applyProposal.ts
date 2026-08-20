/**
 * Headless apply: the API forwards to `apps/sync`, which runs the *same* Applier against the
 * room's Y.Doc (10_INTEGRATIONS.md §10). The API deliberately has no board-writing code of its
 * own — N4 allows exactly one write path, and this is not it.
 */

import type { ApplyResult, ImportProposal } from '@nexus/integrations';

import { loadServerEnvFromProcess } from '../env.ts';

export interface RemoteApplyInput {
  readonly boardId: string;
  readonly proposal: ImportProposal;
  readonly selectedItemIds: readonly string[];
  readonly conflictResolutions: Readonly<Record<string, 'keep' | 'replace' | 'keep_both'>>;
  readonly alreadyApplied?: Readonly<Record<string, string>>;
  readonly now: string;
}

export type ApplyTransport = (url: string, init: RequestInit) => Promise<Response>;

let transport: ApplyTransport = (url, init) => fetch(url, init);

/** Test seam; production always uses `fetch`. */
export function setApplyTransport(next: ApplyTransport): void {
  transport = next;
}

export async function applyProposalRemotely(input: RemoteApplyInput): Promise<ApplyResult> {
  const env = loadServerEnvFromProcess();
  const response = await transport(`${env.SYNC_URL.replace(/\/$/, '')}/internal/proposals/apply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.SYNC_SHARED_SECRET}`,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`sync refused the apply (${String(response.status)}): ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as ApplyResult;
}
