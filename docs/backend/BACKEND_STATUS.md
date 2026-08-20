# Backend status — what exists, what is dormant, what is not built

**Read this first.** Raven's default shape is local (`APP_MODE=local`, see
`docs/adr/ADR-001-local-first.md`). The backend below is **built and green in CI but not required**:
nothing in it runs unless a deployment sets `APP_MODE=server`. It is not dead code and must not be
deleted — it is the other half of the product, kept compiling and tested.

Legend: **Done** = implemented and covered by tests · **Partial** = usable, gaps listed ·
**Not started** = specified only.

| Subsystem                     | State       | Real code path                                           | Notes                                                                                                                                                                                               |
| ----------------------------- | ----------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP server + health          | Done        | `apps/api/src/server.ts`                                 | Fastify; `/healthz`, `/readyz`, metrics on a separate port                                                                                                                                          |
| Env validation                | Done        | `packages/config/src/env.ts`                             | Boot fails on an invalid variable, never starts half-configured                                                                                                                                     |
| Capability registry           | Done        | `packages/config/src/appMode.ts`                         | The switch that turns all of this on                                                                                                                                                                |
| Auth (email + password)       | Done        | `apps/api/src/auth/index.ts`                             | Better-Auth, cookie sessions, signup rate limit                                                                                                                                                     |
| Personal org bootstrap        | Done        | `apps/api/src/auth/personal-org.ts`                      | Every new user gets an org + owner membership                                                                                                                                                       |
| Authorization (roles)         | Done        | `apps/api/src/trpc/trpc.ts` (`orgProcedure`)             | viewer / editor / admin / owner                                                                                                                                                                     |
| Projects                      | Done        | `apps/api/src/trpc/routers/project.ts`                   | list, create; `WorkspaceRepository` server implementation calls these                                                                                                                               |
| Boards                        | Done        | `apps/api/src/trpc/routers/board.ts`                     | list, create                                                                                                                                                                                        |
| Files (presign → complete)    | Done        | `apps/api/src/trpc/routers/files.ts`, `src/files/`       | SigV4 presigner written in-house, magic-byte verification                                                                                                                                           |
| Audit log                     | Done        | `apps/api/src/audit.ts`                                  | Append-only, one row per state change                                                                                                                                                               |
| Database schema               | Done        | `packages/db/prisma/schema.prisma`                       | migrations `0001_init` … `0005_integration_framework`                                                                                                                                               |
| Metrics                       | Done        | `apps/api/src/plugins/metrics.ts`                        | Prometheus text format                                                                                                                                                                              |
| Thumbnails / derivatives      | Not started | —                                                        | `apps/worker` and BullMQ now exist (P9); the derivative consumer itself is still open                                                                                                               |
| Cloud sync (device ↔ server) | Not started | —                                                        | `SYNC_ARCHITECTURE.md`; roadmap P8                                                                                                                                                                  |
| Live collaboration            | Not started | —                                                        | Depends on cloud sync                                                                                                                                                                               |
| Google sign-in                | Not started | —                                                        | `AUTH_GOOGLE.md` has the exact steps                                                                                                                                                                |
| AI / chat backend             | Not started | —                                                        | `CHAT_BACKEND.md`, `FUTURE_AI_BACKEND.md`; roadmap P14                                                                                                                                              |
| Tool runner (integrations)    | Done (P9)   | `apps/runner/`, `apps/worker/`, `packages/integrations/` | Manifest schema, 8-stage pipeline, sandbox + egress proxy, run history, consent gate, scoped API tokens, REST v1. Ships one builtin manifest (`expand-url`); real third-party tools land in P10–P12 |

## The one rule for local mode

A feature that has no meaning without a server is **absent** in local mode, not stubbed. There is no
disabled Login button, no greyed-out "Sync (coming soon)", no fake presence avatars. The enforcement
is `apps/web/src/app/localMode.test.tsx`, which boots the app with `fetch`, `XMLHttpRequest` and
`WebSocket` replaced by throwing stubs.
