/**
 * Dev data set (18_TESTING.md §15): 1 org, 4 users (owner/admin/editor/viewer), 3 projects,
 * 8 boards. Idempotent — re-running upserts its own rows and touches nothing else. Ids are fixed
 * so re-runs and e2e fixtures address the same rows.
 *
 * P1 seeds relational rows only; board *content* (nodes, edges, groups) arrives with the document
 * model in P3, and `Perf 5000` is generated at runtime from a seed, never committed.
 */
import { prisma } from '../src/client';
import { recordAudit } from '../src/audit';

/** Deterministic cuid2-shaped id: 24 lowercase alphanumerics starting with a letter. */
function seedId(kind: string, n: number): string {
  const base = `s${kind}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (base + String(n).padStart(3, '0').repeat(8)).slice(0, 24).padEnd(24, '0');
}

const ORG_ID = seedId('org', 1);

const USERS = [
  { key: 'owner', name: 'Olivia Owner', role: 'owner' as const },
  { key: 'admin', name: 'Adam Admin', role: 'admin' as const },
  { key: 'editor', name: 'Eve Editor', role: 'editor' as const },
  { key: 'viewer', name: 'Victor Viewer', role: 'viewer' as const },
];

const PROJECTS = [
  { key: 'RES', name: 'Research', boards: ['Kitchen Sink', 'Empty', 'Imported'] },
  { key: 'OPS', name: 'Operations', boards: ['Runbooks', 'Vendors', 'Incidents'] },
  { key: 'ARC', name: 'Archive', boards: ['2025 cases', 'Closed'] },
];

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }
  const now = new Date();

  await prisma.organization.upsert({
    where: { id: ORG_ID },
    create: { id: ORG_ID, slug: 'nexus-dev', name: 'NEXUS Dev', updatedAt: now },
    update: { slug: 'nexus-dev', name: 'NEXUS Dev', updatedAt: now },
  });

  const userIds: string[] = [];
  for (const [i, u] of USERS.entries()) {
    const id = seedId('usr', i + 1);
    userIds.push(id);
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        email: `${u.key}@dev.nexus.local`,
        emailVerified: true,
        name: u.name,
        updatedAt: now,
      },
      update: { email: `${u.key}@dev.nexus.local`, name: u.name, updatedAt: now },
    });
    // ponytail: no credential row is seeded, so seed users cannot password-login yet. Better-Auth
    // owns password hashing (15_SECURITY.md §9) and lives in apps/api; upgrade path is to call its
    // `signUpEmail` from an apps/api seed hook with password `dev-only`.
    await prisma.membership.upsert({
      where: { orgId_userId: { orgId: ORG_ID, userId: id } },
      create: {
        id: seedId('mbr', i + 1),
        orgId: ORG_ID,
        userId: id,
        role: u.role,
        joinedAt: now,
        updatedAt: now,
      },
      update: { role: u.role, updatedAt: now },
    });
  }

  const ownerId = userIds[0];
  if (ownerId === undefined) throw new Error('Seed invariant broken: no owner user was created.');

  let boardIndex = 0;
  for (const [i, p] of PROJECTS.entries()) {
    const projectId = seedId('prj', i + 1);
    await prisma.project.upsert({
      where: { id: projectId },
      create: {
        id: projectId,
        orgId: ORG_ID,
        key: p.key,
        name: p.name,
        createdBy: ownerId,
        updatedAt: now,
      },
      update: { key: p.key, name: p.name, updatedAt: now },
    });

    for (const title of p.boards) {
      boardIndex += 1;
      const boardId = seedId('brd', boardIndex);
      await prisma.board.upsert({
        where: { id: boardId },
        create: {
          id: boardId,
          orgId: ORG_ID,
          projectId,
          title,
          createdBy: ownerId,
          updatedAt: now,
        },
        update: { title, projectId, updatedAt: now },
      });
    }
  }

  await recordAudit({
    orgId: ORG_ID,
    actorId: ownerId,
    actorKind: 'system',
    action: 'db.seeded',
    targetKind: 'organization',
    targetId: ORG_ID,
    outcome: 'success',
    metadata: { users: USERS.length, projects: PROJECTS.length, boards: boardIndex },
  });

  process.stdout.write(
    `Seeded org ${ORG_ID}: ${USERS.length} users, ${PROJECTS.length} projects, ${boardIndex} boards\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  })
  .finally(() => prisma.$disconnect());
