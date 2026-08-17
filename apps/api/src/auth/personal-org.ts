// Every signed-up user must land in exactly one org (08_DATA_MODEL.md §4, P1 §5.5): the whole
// authorization model is org-scoped, so a user without a membership can read nothing and create
// nothing. P1 gives each new user a personal org they own; real multi-org invites arrive in P7.
import { prisma } from '@nexus/db';
import { newId, systemClock } from '@nexus/domain';

export interface NewUser {
  id: string;
  email: string;
  name?: string | null;
}

const SLUG_MAX = 40;

/** `Ada Lovelace` → `Ada Lovelace's workspace`; falls back to the email local part. */
export function personalOrgName(user: NewUser): string {
  const display = (user.name ?? '').trim() || (user.email.split('@')[0] ?? 'Personal');
  return `${display}'s workspace`.slice(0, 200);
}

/**
 * Slugs are unique per install, so the readable stem carries a short random suffix instead of a
 * retry loop (same trade-off as `projectKey`): collision-safe enough at 36^6 per stem.
 */
export function personalOrgSlug(
  user: NewUser,
  randomSuffix = Math.random().toString(36).slice(2, 8),
): string {
  const stem = (user.email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX);
  return `${stem === '' ? 'workspace' : stem}-${randomSuffix}`;
}

/**
 * Idempotent: an existing membership wins, so re-running the signup hook (or linking an OAuth
 * account to an existing user) never creates a second org.
 */
export async function ensurePersonalOrg(
  user: NewUser,
): Promise<{ orgId: string; created: boolean }> {
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { orgId: true },
  });
  if (existing) return { orgId: existing.orgId, created: false };

  const org = await prisma.organization.create({
    data: { id: newId.org(), slug: personalOrgSlug(user), name: personalOrgName(user) },
  });
  await prisma.membership.create({
    data: {
      id: newId.membership(),
      orgId: org.id,
      userId: user.id,
      role: 'owner',
      joinedAt: systemClock.now(),
    },
  });
  return { orgId: org.id, created: true };
}
