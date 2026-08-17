# @nexus/db

Prisma schema, migrations, client singleton and the dev seed for NEXUS.
Scope in P1: `organizations`, `users`, `memberships`, `sessions`, `accounts`, `projects`,
`boards`, `audit_log` (20_ROADMAP.md P1 §5.5). The graph projection (`nodes`, `edges`, …) arrives
with P3/P8 — see `NEXUS-SPEC/08_DATA_MODEL.md` §4 for the full target schema.

## Conventions

- `id` is a **cuid2 generated in application code** (`newId.*` from `@nexus/domain`), never by the
  database. A row's id therefore exists before the row does, which offline-first creation needs.
- Every table has `created_at` and `updated_at`. `updated_at` is written by the application
  (Prisma `@updatedAt`) — there is no trigger; a trigger would hide writes from the app's own
  optimistic-concurrency reasoning.
- Columns are snake_case (`@map`), tables snake_case plural (`@@map`).
- `audit_log` is append-only: this package exports `recordAudit()` and nothing that updates or
  deletes an audit row. See "Audit log" below.

## Usage

```ts
import { prisma, recordAudit } from '@nexus/db';

const projects = await prisma.project.findMany({ where: { orgId, deletedAt: null } });
await recordAudit({
  orgId,
  actorId: userId,
  action: 'project.created',
  targetKind: 'project',
  targetId: project.id,
  outcome: 'success',
});
```

The client is a singleton (`src/client.ts`): pool size from `DATABASE_POOL_MAX`, Prisma log levels
derived from `LOG_LEVEL`, and the instance cached on `globalThis` outside production so `tsx watch`
/ Vitest reloads do not open a new pool per reload.

## Migration workflow

Migrations are plain SQL under `prisma/migrations/<n>_<name>/migration.sql`, applied by
`prisma migrate deploy` in the `migrate` job before new pods roll out (19_DEPLOYMENT.md §7).

1. Edit `prisma/schema.prisma`.
2. Generate the SQL against a running dev database:
   `pnpm exec prisma migrate dev --name <name>` — this writes the migration folder and applies it.
   Without a database you may hand-write the folder; the diff must match the schema exactly
   (`pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel
prisma/schema.prisma --shadow-database-url $SHADOW_DATABASE_URL --exit-code` must report no
   drift).
3. Run `node scripts/check-migration-safety.mjs` (also a CI job).
4. `pnpm --filter @nexus/db build` regenerates the Prisma client types.

### Safety check

`scripts/check-migration-safety.mjs` rejects, per 19_DEPLOYMENT.md §7:

- `DROP COLUMN` / `DROP TABLE` / `ALTER COLUMN TYPE` / `RENAME` unless the file is labeled
  `-- nexus:contract` and names the expand migration it retires;
- non-`CONCURRENTLY` `CREATE INDEX` (a concurrent index also needs `-- nexus:no-transaction`);
- `ADD COLUMN ... NOT NULL DEFAULT <volatile>`;
- a missing header comment stating lock impact and estimated duration.

`0001_init` is labeled `-- nexus:initial`: it only creates new objects on an empty database, so its
indexes are intentionally non-concurrent. Every later migration follows the rules above.
Rollback is forward-only — a bad migration is fixed by the next migration.

## Local reset

```bash
docker compose -f infra/docker-compose.yml up -d postgres
pnpm exec prisma migrate reset --force   # drops, re-applies every migration, then runs the seed
pnpm --filter @nexus/db seed             # seed only (idempotent, safe to re-run)
```

`prisma migrate reset` is a **development-only** command; the seed refuses to run when
`NODE_ENV=production`.

## Audit log

`audit_log` rows are written once and never modified (15_SECURITY.md C-42). Two layers enforce it:

1. **Code** — `recordAudit()` is the only writer this package exports; `test/audit.test.ts` asserts
   no update/delete helper exists and that the insert shape is complete.
2. **Grants** — the application database role has `INSERT, SELECT` only. Run once per environment
   as the owner role, after the app role exists:

   ```sql
   REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM nexus_app;
   GRANT  INSERT, SELECT ON audit_log TO nexus_app;
   ```

A `CHECK (updated_at = created_at)` constraint makes any accidental update fail loudly.
Hash-chaining of audit entries (15_SECURITY.md §10.3) is a later phase and will be an additive
migration.
