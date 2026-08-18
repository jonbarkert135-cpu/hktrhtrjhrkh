# Database

**Server mode only.** In local mode there is no database in this sense; see
`docs/adr/ADR-003-local-database.md` for what stores what on the device.

- Engine: **PostgreSQL 16 + pgvector** (the extension is for P9 semantic search; nothing uses it yet).
- Access: Prisma, single client in `packages/db/src/client.ts`.
- Schema: `packages/db/prisma/schema.prisma`.
- Migrations: `packages/db/prisma/migrations/0001_init`, `0002_files`. Applied with `pnpm db:migrate`.
- Safety gate: `scripts/check-migration-safety.mjs` refuses a destructive migration in CI.

## Models

| Model          | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `Organization` | Tenant boundary; every row below hangs off one                 |
| `User`         | Account                                                        |
| `Membership`   | User ↔ Org with a role (`OrgRole`)                            |
| `Session`      | Better-Auth session                                            |
| `Account`      | Better-Auth credential / OAuth link                            |
| `Project`      | Container for boards, files and runs                           |
| `Board`        | One canvas; the CRDT document itself is not stored row-wise    |
| `File`         | Upload record: state machine, sha256, storage key, `FileState` |
| `AuditLog`     | Append-only trail of state changes                             |

## The local ↔ server relationship

The device stores the same _concepts_ (`apps/web/src/data/workspace/local.ts` holds projects and
boards) with fewer columns: no org, no roles, no soft-delete, because a single-user device has no use
for them. A future sync (`SYNC_ARCHITECTURE.md`) maps one to the other; it is not a migration of one
schema into the other, and the local ids are already cuid2s from the same generator
(`packages/domain/src/ids.ts`), so they survive the trip.
