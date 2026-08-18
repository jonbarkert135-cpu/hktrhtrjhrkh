# Backend architecture

One process, module boundaries enforced by dependency-cruiser rather than by network hops
(`docs/adr/ADR-005-modular-monolith.md`).

```
browser (apps/web)
   │  tRPC over HTTP, cookie session            ← only in APP_MODE=server
   ▼
apps/api/src/server.ts            Fastify: CORS, request context, /healthz, /readyz, metrics
   ├── auth/index.ts              Better-Auth (email+password), mounted at /auth
   ├── trpc/context.ts            session → { user, org, role } for every call
   ├── trpc/trpc.ts               publicProcedure · protectedProcedure · orgProcedure(minRole)
   ├── trpc/routers/*.ts          project · board · files · auth
   ├── audit.ts                   append-only trail, one row per state change
   └── files/{s3,storage}.ts      SigV4 presigning, object reads/deletes
        │
        ├── packages/db           Prisma client + schema + migrations (PostgreSQL 16 + pgvector)
        ├── packages/domain       pure logic, no I/O — shared byte-for-byte with the browser
        └── packages/config       env schema + capability registry
```

**Layering rules** (`.dependency-cruiser.cjs`): `domain` imports nothing from `api`, `db` or `web`;
`web` never imports `db`; `api` is the only package that touches Prisma. This is what makes the same
file-policy and CRDT code run unchanged in local mode.

**Request path (server mode).** `httpBatchLink` → Fastify → tRPC context resolves the session cookie
→ `orgProcedure` checks the membership role → handler → Prisma → audit row → typed response.

**Request path (local mode).** There is none. `apps/web/src/app/providers.tsx` never constructs a
tRPC client; the `WorkspaceRepository` in use is the IndexedDB one.
