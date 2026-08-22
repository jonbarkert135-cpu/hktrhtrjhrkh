/**
 * Credential selection for one GitHub request (11_GITHUB.md §2.3).
 *
 * Order is capability-first: an App installation that covers the owner beats the requesting user's
 * OAuth token, which beats an operator-configured service token, which beats anonymous. The
 * function is pure and takes no secrets — it names *which* credential to decrypt, never a value
 * (§2.4: plaintext exists only in worker memory, for the duration of a job).
 */

export type GithubCredential =
  | { readonly kind: 'app'; readonly installationId: string }
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'service' }
  | { readonly kind: 'anonymous' };

export type ConnectionStatus = 'active' | 'revoked' | 'expired' | 'error';

export interface AppInstallation {
  readonly id: string;
  /** Logins this installation covers, as GitHub reports them (case-insensitive here). */
  readonly owners: readonly string[];
}

export interface GithubRequestContext {
  readonly owner: string;
  readonly userId: string;
  readonly appInstallations?: readonly AppInstallation[];
  readonly userToken?: { readonly status: ConnectionStatus } | undefined;
  readonly serviceToken?: boolean;
}

export function selectCredential(ctx: GithubRequestContext): GithubCredential {
  const owner = ctx.owner.toLowerCase();
  const installation = (ctx.appInstallations ?? []).find((candidate) =>
    candidate.owners.some((login) => login.toLowerCase() === owner),
  );
  if (installation !== undefined) return { kind: 'app', installationId: installation.id };
  if (ctx.userToken?.status === 'active') return { kind: 'user', userId: ctx.userId };
  if (ctx.serviceToken === true) return { kind: 'service' };
  return { kind: 'anonymous' };
}

/** Stable identity of the budget bucket a credential spends from (§8.1's `gh:budget:{id}`). */
export function credentialId(credential: GithubCredential): string {
  switch (credential.kind) {
    case 'app':
      return `app:${credential.installationId}`;
    case 'user':
      return `user:${credential.userId}`;
    case 'service':
      return 'service';
    case 'anonymous':
      // One shared IP budget for the whole instance (§2.1).
      return 'anonymous';
  }
}

export const isAuthenticated = (credential: GithubCredential): boolean =>
  credential.kind !== 'anonymous';
