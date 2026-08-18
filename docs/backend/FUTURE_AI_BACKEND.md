# Notes for the next AI agent working on this repository

You are probably here because someone asked you to "add the backend" or "connect the database".
Read this before you touch anything; it will save you a wasted PR.

## 1. The backend already exists and is switched off on purpose

`apps/api` is complete for what it covers (projects, boards, files, auth, audit) and is green in CI.
The product's default shape is local (`docs/adr/ADR-001-local-first.md`). Your task is almost never
"write the backend" — it is "turn on a capability and implement the one missing piece".
Check `BACKEND_STATUS.md` for which pieces are genuinely missing.

## 2. Never add a mode check to a component

If you find yourself writing `if (appMode === 'local')` inside a React component, stop. There are
exactly three legitimate seams (`docs/adr/ADR-004-repository-abstraction.md`):
`WorkspaceRepository`, the upload transport, and the route guard / account menu. Anything else means
the feature needs a repository method that both implementations can honour.

## 3. Never delete the backend to "simplify"

It is not dead code. It is the other deployment shape and it is tested.

## 4. Never fake a server feature

No disabled buttons, no "Coming soon" chips, no mock data in the core. A feature that has no local
meaning is absent in local mode. The reviewer that enforces this is
`apps/web/src/app/localMode.test.tsx`; if you add a component that reaches for the network at boot,
that suite fails.

## 5. Where things live

| You want to…               | Go to                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| Add a capability flag      | `packages/config/src/appMode.ts` (and a dependency edge)            |
| Add a data operation       | `apps/web/src/data/workspace/types.ts`, then _both_ implementations |
| Add an API procedure       | `apps/api/src/trpc/routers/`, then `BACKEND_API.md`                 |
| Change the database        | `packages/db/prisma/schema.prisma` + a migration                    |
| Understand the phase plan  | `RAVEN-SPEC/20_ROADMAP.md`                                          |
| Understand a past decision | `docs/adr/`                                                         |

## 6. The gate before you open a PR

`pnpm lint && pnpm depcruise && pnpm typecheck && pnpm test && pnpm exec prettier --check .`
CI runs thirteen checks; a PR merges at 13/13, and `coverage-gate` requires 80% line coverage on the
files you changed.
