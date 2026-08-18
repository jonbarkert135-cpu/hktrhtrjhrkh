# Turning the backend on

Local mode needs nothing from this file. Follow it only to run a deployment with accounts and a
shared database.

## 1. Configure

```bash
cp .env.example .env
```

Set, at minimum:

```dotenv
APP_MODE=server
VITE_APP_MODE=server                # the bundle is built for one shape; they must match
DATABASE_URL=postgres://raven:...@localhost:5432/raven
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000   # MinIO locally
S3_BUCKET=raven
S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
AUTH_SECRET=<32+ random chars>
AUTH_TRUSTED_ORIGINS=http://localhost:5173
PUBLIC_APP_URL=http://localhost:5173
```

Optional capabilities stay off unless you set them (`CLOUD_SYNC_ENABLED`, `COLLABORATION_ENABLED`,
`GOOGLE_AUTH_ENABLED`). Enabling one whose dependency is off stops the boot with a message naming
the fix — that is `packages/config/src/appMode.ts` doing its job.

## 2. Start the infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis minio
pnpm db:migrate     # packages/db/prisma/migrations
pnpm db:seed        # optional dev data; seeded logins use the password dev-only
```

## 3. Run

```bash
pnpm dev            # api on :3001, web on :5173
curl -f localhost:3001/readyz
```

## 4. Verify the shape

- `/login` exists and the account menu offers Sign out (both absent in local mode).
- The project rail is served by `apps/api/src/trpc/routers/project.ts` — check the API log.
- `docs/backend/BACKEND_STATUS.md` lists what is genuinely available; anything marked _Not started_
  is not hidden behind a flag, it does not exist yet.

## VPS deployment without Kubernetes

`docker compose -f infra/docker-compose.yml up -d` with `PUBLIC_HOSTNAME` set brings up Caddy (TLS
via Let's Encrypt), the API, the web bundle, Postgres, Redis and MinIO on a single box. No
Kubernetes, no privileged containers, no cluster-scoped anything — see `DEPLOYMENT.md`.
