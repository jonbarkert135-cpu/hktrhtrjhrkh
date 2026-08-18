# Backend API surface

Everything is tRPC v11 over `POST /trpc`, superjson-encoded, plus Better-Auth's own routes under
`/auth`. Types are exported from `@nexus/api` and consumed by the browser client, so the contract is
compile-time checked rather than documented twice.

Router: `apps/api/src/trpc/router.ts`.

| Procedure        | Kind     | Min role | Code                                   |
| ---------------- | -------- | -------- | -------------------------------------- |
| `auth.me`        | query    | session  | `apps/api/src/trpc/routers/auth.ts`    |
| `project.list`   | query    | viewer   | `apps/api/src/trpc/routers/project.ts` |
| `project.create` | mutation | editor   | `apps/api/src/trpc/routers/project.ts` |
| `board.list`     | query    | viewer   | `apps/api/src/trpc/routers/board.ts`   |
| `board.create`   | mutation | editor   | `apps/api/src/trpc/routers/board.ts`   |
| `files.presign`  | mutation | editor   | `apps/api/src/trpc/routers/files.ts`   |
| `files.complete` | mutation | editor   | `apps/api/src/trpc/routers/files.ts`   |
| `files.get`      | query    | viewer   | `apps/api/src/trpc/routers/files.ts`   |
| `files.list`     | query    | viewer   | `apps/api/src/trpc/routers/files.ts`   |
| `files.download` | query    | viewer   | `apps/api/src/trpc/routers/files.ts`   |
| `files.delete`   | mutation | editor   | `apps/api/src/trpc/routers/files.ts`   |

HTTP endpoints: `GET /healthz`, `GET /readyz`, `/auth/*` (Better-Auth), metrics on its own port
(`apps/api/src/plugins/metrics.ts`), and `/api/test/*` which only exists when
`NEXUS_TEST_ENDPOINTS=true` and is refused outright in production.

**Errors** carry a tRPC code; the browser maps codes to sentences in `apps/web/src/lib/trpc.tsx`.
Add a code there when you add one here, or the user gets the fallback copy.

**Which of these the browser actually calls in server mode:** `project.*` and `board.*` through
`apps/web/src/data/workspace/server.ts`, `files.presign`/`files.complete` through
`apps/web/src/files/useUpload.ts`. Nothing else is wired to UI yet.
