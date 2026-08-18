import { recordAudit } from '@nexus/db';
import type { AuditEntry } from '@nexus/db';

/**
 * Append-only audit writes (15_SECURITY.md §8). Auditing must never break the request it
 * describes, so failures are logged and swallowed.
 *
 * `audit_log.org_id` is a non-null FK, so an event that has no organization yet (failed login,
 * signup before the first org exists) cannot be stored.
 * ponytail: those events are logged as `audit.skipped` on the structured log stream instead.
 * Upgrade path: make `org_id` nullable in `packages/db` and drop the branch below.
 */
export type AuditAction =
  | 'auth.signup'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'project.created'
  | 'project.deleted'
  | 'board.created'
  | 'file.uploaded'
  | 'file.rejected'
  | 'file.deleted';

export interface AuditInput extends Omit<AuditEntry, 'action' | 'orgId'> {
  action: AuditAction;
  orgId: string | null;
}

export interface AuditLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export async function audit(input: AuditInput, logger: AuditLogger): Promise<void> {
  const { orgId, ...rest } = input;
  if (orgId === null) {
    logger.warn({ event: 'audit.skipped', ...rest }, 'audit event has no organization');
    return;
  }
  try {
    await recordAudit({ ...rest, orgId });
  } catch (error) {
    logger.error(
      { event: 'audit.write_failed', action: input.action, error },
      'audit write failed',
    );
  }
}
