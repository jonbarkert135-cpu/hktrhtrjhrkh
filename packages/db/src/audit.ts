import type { Prisma, PrismaClient } from '@prisma/client';
import { newId, systemClock } from '@nexus/domain';
import type { Clock } from '@nexus/domain';
import { prisma } from './client';

/**
 * One audit entry. Timestamps are server-assigned (15_SECURITY.md C-45): the caller cannot pass a
 * time. There is deliberately no update or delete counterpart — audit_log is append-only, and the
 * database grants back that up (see prisma/migrations/0001_init/migration.sql).
 */
export type AuditEntry = {
  orgId: string;
  action: string;
  outcome: 'success' | 'denied' | 'error';
  targetKind: string;
  actorKind?: 'user' | 'system' | 'integration';
  actorId?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(
  entry: AuditEntry,
  deps: { db?: PrismaClient; clock?: Clock } = {},
): Promise<string> {
  const db = deps.db ?? prisma;
  const now = (deps.clock ?? systemClock).now();
  const id = newId.audit();

  await db.auditLog.create({
    data: {
      id,
      orgId: entry.orgId,
      actorId: entry.actorId ?? null,
      actorKind: entry.actorKind ?? (entry.actorId ? 'user' : 'system'),
      action: entry.action,
      targetKind: entry.targetKind,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      outcome: entry.outcome,
      createdAt: now,
      // equal to createdAt by construction; the CHECK constraint makes any later edit fail
      updatedAt: now,
    },
  });

  return id;
}
