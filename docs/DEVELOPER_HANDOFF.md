# Developer handoff

Everything a new developer (or agent) needs to be productive here, in reading order.

## 1. Run it

```bash
pnpm install
pnpm dev:local        # local mode: web only, no database, no account
```

That is the whole setup. Server mode is optional and documented in
[`backend/BACKEND_SETUP.md`](backend/BACKEND_SETUP.md).

## 2. Understand the two shapes

Raven ships one code base in two shapes, selected by `APP_MODE`
([ADR-001](adr/ADR-001-local-first.md)). Local is the default: no account, no server, no network.
Which subsystems exist is decided in `packages/config/src/appMode.ts` and nowhere else
([ADR-002](adr/ADR-002-feature-flags.md)).

## 3. Map of the repository

| Path                     | What it is                                                              |
| ------------------------ | ----------------------------------------------------------------------- |
| `apps/web`               | React 19 + Vite SPA — the whole product in local mode                   |
| `apps/api`               | Fastify + tRPC API — server mode only                                   |
| `packages/domain`        | Pure logic (ids, board document, file policy). No I/O, shared by both   |
| `packages/canvas-engine` | Hybrid Canvas2D/DOM rendering engine                                    |
| `packages/db`            | Prisma schema, migrations, seed                                         |
| `packages/config`        | Env schema, capability registry, shared eslint/tsconfig/vitest          |
| `packages/ui`            | Design-token components                                                 |
| `RAVEN-SPEC/`            | The 21 specification documents; `20_ROADMAP.md` tracks phase completion |
| `docs/adr/`              | Why things are the way they are                                         |
| `docs/backend/`          | The dormant half: status, setup, API, database, sync, deployment        |
| `prompts/`               | The owner's source prompts; read `prompts/README.md` before using them  |

## 4. Where the local-first behaviour actually lives

| Concern                  | File                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| Mode + capabilities      | `packages/config/src/appMode.ts`, `apps/web/src/mode/appMode.ts` |
| Provider selection       | `apps/web/src/app/providers.tsx`                                 |
| Projects/boards (local)  | `apps/web/src/data/workspace/local.ts`                           |
| Projects/boards (server) | `apps/web/src/data/workspace/server.ts`                          |
| Board document + history | `apps/web/src/data/docProvider.tsx`, `persistence.ts`            |
| Attachments (local)      | `apps/web/src/data/opfs.ts`, `src/files/localTransport.ts`       |
| Attachments (server)     | `apps/api/src/trpc/routers/files.ts`, `apps/api/src/files/`      |
| Route guard              | `apps/web/src/app/router.tsx`                                    |

## 5. Conventions that are enforced, not suggested

- Conventional commits (`commitlint.config.cjs`).
- No `TODO`/`FIXME` in committed code (`scripts/check-no-todo.mjs`), no skipped tests
  (`scripts/check-skips.mjs`).
- Layer boundaries (`.dependency-cruiser.cjs`): `domain` imports no I/O, `web` never imports `db`.
- Design values come from tokens, not literals (`no-hardcoded-design-values` eslint rule).
- 80% line coverage on changed files (`scripts/diff-coverage.mjs`).

## 6. Before you open a PR

```bash
pnpm lint && pnpm depcruise && node scripts/check-no-todo.mjs && node scripts/check-skips.mjs \
  && pnpm exec prettier --check . && pnpm typecheck && pnpm test
```

CI runs thirteen checks and a PR merges at 13/13. Then tick your item in `RAVEN-SPEC/20_ROADMAP.md`.
