# NEXUS — 19 — DEPLOYMENT, CI/CD AND OPERATIONS

## Scope

Defines every environment NEXUS runs in and how code reaches them: config matrix, the reference
`docker-compose.yml` for self-hosting, the Kubernetes manifest set (including the gVisor
RuntimeClass and runner network isolation), the GitHub Actions pipeline, database migration policy,
release/versioning, feature flags, backup/restore and DR, the observability stack with concrete
metric names and alert thresholds, capacity planning, and the production readiness checklist.
Self-hosting is a product requirement (`00_MASTER.md` §2), so the compose path is first-class, not
a demo.

---

## 1. Environments

|                | local                           | preview (per-PR)                        | staging                             | production                       |
| -------------- | ------------------------------- | --------------------------------------- | ----------------------------------- | -------------------------------- |
| Purpose        | development                     | review a PR end-to-end                  | rehearse release, load/DR drills    | users                            |
| Topology       | docker-compose                  | namespace per PR in the staging cluster | full k8s, 1 replica each            | full k8s, HA                     |
| Domain         | `localhost`                     | `pr-<n>.preview.nexus.internal`         | `staging.nexus.app`                 | `nexus.app`                      |
| Postgres       | container, ephemeral            | shared cluster, DB per PR               | dedicated, PITR on                  | dedicated HA, PITR on            |
| Redis          | container                       | shared, DB index per PR                 | dedicated                           | dedicated, replicated            |
| Object storage | MinIO container                 | MinIO, bucket per PR                    | S3 bucket                           | S3 bucket, versioned             |
| Runner         | docker, runc                    | k8s, gVisor                             | k8s, gVisor                         | k8s, gVisor, dedicated node pool |
| Real tools     | stubbed by default              | stubbed                                 | real, consented targets only        | real                             |
| AI provider    | mock or dev key                 | mock                                    | real, low quota                     | real                             |
| Auth           | email/password, mail to Mailpit | same                                    | OAuth + email                       | OAuth + email, MFA for admins    |
| Data           | seeded (`pnpm db:seed`)         | seeded                                  | anonymized restore of a prod backup | real                             |
| Telemetry      | console exporter                | OTLP → staging collector                | full stack                          | full stack + paging              |
| Retention      | n/a                             | deleted on PR close or after 72 h       | 14 days backups                     | 35 days PITR                     |

### 1.1 Configuration matrix

All configuration is environment variables, validated at boot by a zod schema in
`packages/config/src/env.ts`. **The process refuses to start on an invalid or missing required
variable** — no defaults that silently weaken security.

```ts
export const serverEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    NEXUS_ENV: z.enum(['local', 'preview', 'staging', 'production']),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
    REDIS_URL: z.string().url(),
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false), // true for MinIO
    AUTH_SECRET: z.string().min(32),
    AUTH_TRUSTED_ORIGINS: z.string().transform((s) => s.split(',')),
    PUBLIC_APP_URL: z.string().url(),
    SYNC_URL: z.string().url(),
    SYNC_SHARED_SECRET: z.string().min(32), // API signs board tokens, sync verifies
    RUNNER_URL: z.string().url(),
    RUNNER_SHARED_SECRET: z.string().min(32),
    EGRESS_PROXY_URL: z.string().url(),
    EGRESS_ALLOWLIST: z.string().default(''), // comma-separated host patterns
    AI_PROVIDER: z.enum(['openai-compatible', 'mock']).default('mock'),
    AI_BASE_URL: z.string().url().optional(),
    AI_API_KEY: z.string().optional(),
    AI_MONTHLY_BUDGET_USD: z.coerce.number().default(50),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_SERVICE_NAME: z.string().default('nexus-api'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    NEXUS_TEST_ENDPOINTS: z.coerce.boolean().default(false),
    NEXUS_INTEGRATIONS_MODE: z.enum(['real', 'stub']).default('real'),
    FEATURE_FLAGS: z.string().default(''), // csv of enabled flags, see §9
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && v.NEXUS_TEST_ENDPOINTS)
      ctx.addIssue({ code: 'custom', message: 'NEXUS_TEST_ENDPOINTS must be false in production' });
    if (v.AI_PROVIDER !== 'mock' && !v.AI_API_KEY)
      ctx.addIssue({ code: 'custom', message: 'AI_API_KEY required for a non-mock provider' });
  });
```

Client-side config is a separate schema (`clientEnv`) with a `VITE_` prefix and **no secrets**; a
build test greps the web bundle for every server secret name and fails if any appears.

Secret handling: local `.env` (gitignored, `.env.example` committed with dummy values); preview and
staging use Kubernetes Secrets from the cluster's external secret store; production secrets are
sealed and rotated quarterly (`15_SECURITY.md` §7). No secret is ever printed; the logger's
redaction list is unit-tested (`18_TESTING.md` §11).

Node processes resolve their configuration through `loadServerEnvFromProcess()`
(`packages/config/src/env-file.ts`), which fills **only unset** variables from `.env` and — when
`CI` is set — from the committed `infra/ci/.env.ci` (dummy values for ephemeral CI service
containers). The real environment always wins, and nothing is read when `NODE_ENV=production`, so a
deployed image can never be configured by a file that leaked into the build context. The browser
bundle keeps importing `env.ts` only, which stays free of `node:fs`.

---

## 2. Service inventory

| Service          | Image                              | Port      | Scaling unit                      | Notes                                     |
| ---------------- | ---------------------------------- | --------- | --------------------------------- | ----------------------------------------- |
| `web`            | static build served by `caddy`     | 8080      | CDN/replicas                      | immutable assets, `index.html` no-cache   |
| `api`            | node:22-alpine                     | 3001      | CPU-bound, HPA on CPU 65 %        | Fastify + tRPC + REST                     |
| `sync`           | node:22-alpine                     | 3002      | connection-bound, HPA on WS conns | Hocuspocus + projection                   |
| `worker`         | node:22-alpine                     | —         | queue-depth driven (KEDA)         | BullMQ consumers                          |
| `runner`         | node:22-alpine + docker/CRI client | 3003      | job-bound, dedicated pool         | spawns tool containers                    |
| `egress-proxy`   | `envoy` or `squid`                 | 3128      | 2 replicas                        | allowlist enforcement for runner + unfurl |
| `postgres`       | postgres:16 (+pgvector)            | 5432      | vertical + read replica           |                                           |
| `redis`          | redis:7                            | 6379      | vertical                          | BullMQ + Hocuspocus fanout                |
| `minio`          | minio (self-host only)             | 9000/9001 | vertical                          | S3 in cloud                               |
| `otel-collector` | otel/opentelemetry-collector       | 4317      | 2 replicas                        | traces/metrics/logs pipeline              |

---

## 3. Self-hosting reference: `infra/docker-compose.yml`

Single-host deployment, the supported self-host path. Runs everything except gVisor (noted below).

```yaml
name: nexus

x-node-common: &node-common
  restart: unless-stopped
  environment: &node-env
    NODE_ENV: production
    NEXUS_ENV: production
    DATABASE_URL: postgres://nexus:${POSTGRES_PASSWORD}@postgres:5432/nexus
    REDIS_URL: redis://redis:6379
    S3_ENDPOINT: http://minio:9000
    S3_BUCKET: nexus
    S3_ACCESS_KEY_ID: ${MINIO_ROOT_USER}
    S3_SECRET_ACCESS_KEY: ${MINIO_ROOT_PASSWORD}
    S3_FORCE_PATH_STYLE: 'true'
    AUTH_SECRET: ${AUTH_SECRET}
    AUTH_TRUSTED_ORIGINS: ${PUBLIC_APP_URL}
    PUBLIC_APP_URL: ${PUBLIC_APP_URL}
    SYNC_URL: http://sync:3002
    SYNC_SHARED_SECRET: ${SYNC_SHARED_SECRET}
    RUNNER_URL: http://runner:3003
    RUNNER_SHARED_SECRET: ${RUNNER_SHARED_SECRET}
    EGRESS_PROXY_URL: http://egress-proxy:3128
    EGRESS_ALLOWLIST: ${EGRESS_ALLOWLIST:-api.github.com,raw.githubusercontent.com,objects.githubusercontent.com}
    OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4317
    LOG_LEVEL: ${LOG_LEVEL:-info}
  logging:
    driver: json-file
    options: { max-size: '10m', max-file: '5' }

services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: nexus
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: nexus
    command:
      - postgres
      - -c
      - shared_buffers=1GB
      - -c
      - max_connections=200
      - -c
      - work_mem=16MB
      - -c
      - wal_level=replica
      - -c
      - max_wal_size=4GB
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./backups:/backups
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U nexus -d nexus']
      interval: 10s
      timeout: 5s
      retries: 12
    networks: [core]

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command:
      [
        'redis-server',
        '--appendonly',
        'yes',
        '--maxmemory',
        '1gb',
        '--maxmemory-policy',
        'noeviction',
      ]
    volumes: [redisdata:/data]
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 10
    networks: [core]

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: ['server', '/data', '--console-address', ':9001']
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes: [miniodata:/data]
    healthcheck:
      test: ['CMD', 'mc', 'ready', 'local']
      interval: 15s
      timeout: 5s
      retries: 10
    networks: [core]

  migrate:
    <<: *node-common
    image: ghcr.io/nexus/api:${NEXUS_VERSION}
    restart: 'no'
    command: ['node', 'dist/migrate.js', 'deploy']
    depends_on:
      postgres: { condition: service_healthy }
    networks: [core]

  api:
    <<: *node-common
    image: ghcr.io/nexus/api:${NEXUS_VERSION}
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    environment:
      <<: *node-env
      OTEL_SERVICE_NAME: nexus-api
    healthcheck:
      test: ['CMD', 'node', 'dist/healthcheck.js', 'http://127.0.0.1:3001/healthz']
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks: [core, edge]

  sync:
    <<: *node-common
    image: ghcr.io/nexus/sync:${NEXUS_VERSION}
    depends_on:
      migrate: { condition: service_completed_successfully }
    environment:
      <<: *node-env
      OTEL_SERVICE_NAME: nexus-sync
    healthcheck:
      test: ['CMD', 'node', 'dist/healthcheck.js', 'http://127.0.0.1:3002/healthz']
      interval: 15s
      timeout: 5s
      retries: 5
    networks: [core, edge]

  worker:
    <<: *node-common
    image: ghcr.io/nexus/worker:${NEXUS_VERSION}
    depends_on:
      migrate: { condition: service_completed_successfully }
    environment:
      <<: *node-env
      OTEL_SERVICE_NAME: nexus-worker
    networks: [core, egress]

  runner:
    <<: *node-common
    image: ghcr.io/nexus/runner:${NEXUS_VERSION}
    environment:
      <<: *node-env
      OTEL_SERVICE_NAME: nexus-runner
      RUNNER_TOOL_IMAGES: >-
        sherlock=sherlock/sherlock@sha256:${SHERLOCK_DIGEST},
        spiderfoot=ghcr.io/smicallef/spiderfoot@sha256:${SPIDERFOOT_DIGEST}
      RUNNER_MAX_CONCURRENCY: '4'
      RUNNER_DEFAULT_TIMEOUT_MS: '300000'
    # The runner spawns tool containers; it needs a container runtime socket.
    # Prefer a rootless/proxied socket. On Kubernetes this is replaced by the Job API (§4).
    volumes:
      - ${DOCKER_SOCKET:-/run/user/1000/docker.sock}:/var/run/docker.sock:ro
    networks: [core]

  egress-proxy:
    image: envoyproxy/envoy:v1.31-latest
    restart: unless-stopped
    command: ['-c', '/etc/envoy/envoy.yaml']
    volumes:
      - ./egress/envoy.yaml:/etc/envoy/envoy.yaml:ro
    networks: [core, egress]

  web:
    image: ghcr.io/nexus/web:${NEXUS_VERSION}
    restart: unless-stopped
    depends_on: [api, sync]
    networks: [edge]

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ['80:80', '443:443']
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
    depends_on: [web, api, sync]
    networks: [edge]

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    restart: unless-stopped
    command: ['--config=/etc/otel/config.yaml']
    volumes: [./otel/config.yaml:/etc/otel/config.yaml:ro]
    networks: [core]

networks:
  edge: {}
  core: { internal: true }
  egress: {} # only worker + proxy; tool containers get no network at all

volumes:
  pgdata: {}
  redisdata: {}
  miniodata: {}
  caddydata: {}
  caddyconfig: {}
```

Tool containers are created by the runner (not by compose) with exactly these flags — this is the
sandbox baseline from `00_MASTER.md` §2 and `15_SECURITY.md`:

```
docker run --rm
  --user 65532:65532
  --read-only
  --tmpfs /work:rw,noexec,nosuid,nodev,size=256m
  --workdir /work
  --cap-drop ALL
  --security-opt no-new-privileges
  --security-opt seccomp=/etc/nexus/seccomp.json
  --pids-limit 128
  --memory 512m --memory-swap 512m --cpus 1.0
  --network none                       # egress, when the manifest allows it, is via HTTP(S)_PROXY
                                       # on an attached proxy-only network, never a default route
  --env HTTPS_PROXY=http://egress-proxy:3128
  --stop-timeout 5
  <tool-image-pinned-by-digest> <argv from manifest, never a shell string>
```

**gVisor note:** compose supports `runtime: runsc` if gVisor is installed on the host; the runner
adds `--runtime=runsc` when `RUNNER_RUNTIME=runsc`. It is optional for self-hosting (single-tenant,
operator-controlled) and **mandatory in production** (multi-tenant), where it is expressed as a
Kubernetes RuntimeClass (§4.3).

`Caddyfile` (reference):

```
{$PUBLIC_HOSTNAME} {
  encode zstd gzip
  @api  path /api/* /trpc/*
  handle @api { reverse_proxy api:3001 }
  handle /sync* { reverse_proxy sync:3002 }
  handle { reverse_proxy web:8080 }
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Content-Security-Policy "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' wss:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'"
    -Server
  }
}
```

---

## 4. Kubernetes

`infra/k8s/` uses Kustomize: `base/` + `overlays/{preview,staging,production}`.

```text
infra/k8s/
├─ base/
│  ├─ namespace.yaml
│  ├─ configmap-app.yaml
│  ├─ secret.example.yaml           (never real values; ExternalSecret in overlays)
│  ├─ deployment-api.yaml
│  ├─ deployment-sync.yaml
│  ├─ deployment-web.yaml
│  ├─ deployment-worker.yaml
│  ├─ deployment-runner.yaml
│  ├─ deployment-egress-proxy.yaml
│  ├─ service-*.yaml
│  ├─ ingress.yaml
│  ├─ hpa-api.yaml, hpa-sync.yaml, keda-worker.yaml
│  ├─ pdb-*.yaml
│  ├─ runtimeclass-gvisor.yaml
│  ├─ networkpolicy-default-deny.yaml
│  ├─ networkpolicy-runner.yaml
│  ├─ networkpolicy-api.yaml
│  ├─ job-migrate.yaml
│  └─ servicemonitor-*.yaml
└─ overlays/…
```

### 4.1 Deployment shape (api, representative)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: nexus-api, labels: { app: nexus, component: api } }
spec:
  replicas: 3
  strategy: { type: RollingUpdate, rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } }
  selector: { matchLabels: { app: nexus, component: api } }
  template:
    metadata:
      labels: { app: nexus, component: api }
      annotations: { prometheus.io/scrape: 'true', prometheus.io/port: '9464' }
    spec:
      serviceAccountName: nexus-api
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        fsGroup: 65532
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: api
          image: ghcr.io/nexus/api:v1.4.2 # never :latest; digest pinned by the release automation
          ports: [{ containerPort: 3001 }, { containerPort: 9464, name: metrics }]
          envFrom: [{ configMapRef: { name: nexus-app } }, { secretRef: { name: nexus-secrets } }]
          resources:
            requests: { cpu: '500m', memory: '512Mi' }
            limits: { cpu: '2', memory: '1Gi' }
          readinessProbe:
            {
              httpGet: { path: /readyz, port: 3001 },
              initialDelaySeconds: 5,
              periodSeconds: 5,
              failureThreshold: 3,
            }
          livenessProbe:
            {
              httpGet: { path: /healthz, port: 3001 },
              initialDelaySeconds: 20,
              periodSeconds: 15,
              failureThreshold: 4,
            }
          startupProbe:
            { httpGet: { path: /healthz, port: 3001 }, periodSeconds: 5, failureThreshold: 24 }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ['ALL'] }
          volumeMounts: [{ name: tmp, mountPath: /tmp }]
      volumes: [{ name: tmp, emptyDir: { medium: Memory, sizeLimit: 64Mi } }]
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector: { matchLabels: { app: nexus, component: api } }
```

Resource requests/limits for the rest:

| Component          | requests cpu/mem | limits cpu/mem | replicas (prod)              |
| ------------------ | ---------------- | -------------- | ---------------------------- |
| web (caddy)        | 50m / 64Mi       | 200m / 128Mi   | 2                            |
| api                | 500m / 512Mi     | 2 / 1Gi        | 3 (HPA 3–12)                 |
| sync               | 500m / 768Mi     | 2 / 2Gi        | 3 (HPA 3–10 on WS conns)     |
| worker             | 300m / 512Mi     | 2 / 1Gi        | 2 (KEDA 2–20 on queue depth) |
| runner (control)   | 200m / 256Mi     | 1 / 512Mi      | 2                            |
| tool pod (per run) | 250m / 256Mi     | 1 / 512Mi      | ephemeral, gVisor            |
| egress-proxy       | 200m / 128Mi     | 1 / 512Mi      | 2                            |
| otel-collector     | 200m / 256Mi     | 1 / 1Gi        | 2                            |

`sync` gets the largest memory limit because each open board holds a `Y.Doc` in memory; see §13.

### 4.2 Runner as a Job factory

The runner does **not** mount a container socket in Kubernetes. It creates a `Job` per tool run via
the API server using a tightly scoped Role (`create/get/list/watch/delete` on `jobs` and `pods/log`
in the `nexus-runs` namespace only). The Job pod template:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  namespace: nexus-runs
  labels: { app: nexus, component: tool-run, nexus/run-id: '<runId>', nexus/tool: 'sherlock' }
spec:
  backoffLimit: 0 # a failed tool run is a domain event, never a silent retry
  activeDeadlineSeconds: 300
  ttlSecondsAfterFinished: 600
  template:
    spec:
      runtimeClassName: gvisor
      restartPolicy: Never
      automountServiceAccountToken: false
      serviceAccountName: nexus-tool-null # zero permissions
      securityContext:
        { runAsNonRoot: true, runAsUser: 65532, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: tool
          image: sherlock/sherlock@sha256:<pinned>
          args: ['--json', '/work/out.json', '--timeout', '30', '<username>']
          env:
            - { name: HTTPS_PROXY, value: 'http://egress-proxy.nexus.svc:3128' }
            - { name: HTTP_PROXY, value: 'http://egress-proxy.nexus.svc:3128' }
            - { name: NO_PROXY, value: '' }
          resources:
            requests: { cpu: '250m', memory: '256Mi', ephemeral-storage: '128Mi' }
            limits: { cpu: '1', memory: '512Mi', ephemeral-storage: '512Mi' }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ['ALL'] }
          volumeMounts: [{ name: work, mountPath: /work }]
      volumes: [{ name: work, emptyDir: { medium: Memory, sizeLimit: 256Mi } }]
```

Output is collected by the runner from the pod's stdout and from a sidecar-free convention: the
tool writes to `/work`, and the runner streams the file back through `kubectl cp`-equivalent API
before deleting the Job. Output over 20 MB is truncated with `partial: true`.

### 4.3 gVisor RuntimeClass

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata: { name: gvisor }
handler: runsc
scheduling:
  nodeSelector: { nexus.io/sandbox: 'gvisor' }
  tolerations:
    [{ key: 'nexus.io/sandbox', operator: 'Equal', value: 'gvisor', effect: 'NoSchedule' }]
overhead:
  podFixed: { cpu: '100m', memory: '128Mi' }
```

Tool pods run only on the tainted `gvisor` node pool; application pods never schedule there. If the
RuntimeClass is absent (e.g. a self-managed cluster without gVisor), the runner refuses to start
unless `RUNNER_ALLOW_UNSANDBOXED=true` is explicitly set, which logs a `WARN` on every run and is
surfaced in the admin UI as a security banner.

### 4.4 Network policies

Default deny for the whole namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: nexus }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

Runner and tool isolation (`nexus-runs` namespace):

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: tool-run-isolation, namespace: nexus-runs }
spec:
  podSelector: { matchLabels: { component: tool-run } }
  policyTypes: [Ingress, Egress]
  ingress: [] # nothing may talk to a tool pod
  egress:
    - to:
        - namespaceSelector: { matchLabels: { name: nexus } }
          podSelector: { matchLabels: { component: egress-proxy } }
      ports: [{ protocol: TCP, port: 3128 }]
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
```

Cloud metadata endpoints (`169.254.169.254`, `fd00:ec2::254`) are additionally blocked at the CNI
level for every namespace, and the egress proxy rejects them regardless of allowlist (`15_SECURITY.md`).

Explicit policies also exist for: api → postgres/redis/s3/sync/runner only; sync → postgres/redis
only; worker → postgres/redis/s3/egress-proxy only; nothing → runner except api.

---

## 5. CI pipeline (GitHub Actions)

`.github/workflows/ci.yml` — required for every PR. Jobs run in parallel where possible; `e2e`,
`visual` and `bench` depend on `build`.

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
  packages: write
  id-token: write

env:
  NODE_VERSION: '22'
  PNPM_VERSION: '9'
  TURBO_TELEMETRY_DISABLED: '1'

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs: { cache-key: ${{ steps.k.outputs.key }} }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - id: k
        run: echo "key=${{ hashFiles('pnpm-lock.yaml') }}" >> "$GITHUB_OUTPUT"

  lint:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/bootstrap
      - run: pnpm lint
      - run: pnpm depcruise            # layer boundaries, 00_MASTER §5
      - run: node scripts/check-no-todo.mjs
      - run: node scripts/check-skips.mjs
      - run: pnpm format:check

  typecheck:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/bootstrap
      - run: pnpm typecheck            # tsc --noEmit, all packages, strict

  unit:
    needs: setup
    runs-on: ubuntu-latest
    strategy: { fail-fast: false, matrix: { shard: [1, 2, 3, 4] } }
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env: { POSTGRES_PASSWORD: test, POSTGRES_DB: nexus_test, POSTGRES_USER: nexus }
        options: >-
          --health-cmd "pg_isready -U nexus" --health-interval 5s --health-timeout 5s --health-retries 12
        ports: ['5432:5432']
      redis:
        image: redis:7-alpine
        options: --health-cmd "redis-cli ping" --health-interval 5s --health-retries 10
        ports: ['6379:6379']
    steps:
      - uses: ./.github/actions/bootstrap
      - run: pnpm db:migrate:test
      - run: pnpm test --shard=${{ matrix.shard }}/4 --coverage
      - uses: actions/upload-artifact@v4
        with: { name: coverage-${{ matrix.shard }}, path: '**/coverage/coverage-final.json' }

  coverage-gate:
    needs: unit
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/bootstrap
      - uses: actions/download-artifact@v4
        with: { pattern: coverage-*, merge-multiple: true, path: coverage-parts }
      - run: node scripts/merge-coverage.mjs && node scripts/check-coverage.mjs && node scripts/diff-coverage.mjs

  build:
    needs: [lint, typecheck]
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/bootstrap
      - run: pnpm build
      - run: node scripts/check-bundle-secrets.mjs
      - run: node scripts/check-bundle-budget.mjs      # web initial JS <= 250 KB gzip
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: 'apps/*/dist', retention-days: 7 }

  e2e:
    needs: build
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v1.50.0-jammy
    strategy: { fail-fast: false, matrix: { shard: [1, 2, 3, 4] } }
    services: { postgres: { image: pgvector/pgvector:pg16, ports: ['5432:5432'], env: { POSTGRES_PASSWORD: test, POSTGRES_USER: nexus, POSTGRES_DB: nexus_test } }, redis: { image: redis:7-alpine, ports: ['6379:6379'] }, minio: { image: minio/minio, ports: ['9000:9000'] } }
    env:
      NEXUS_INTEGRATIONS_MODE: stub
      NEXUS_TEST_ENDPOINTS: 'true'
      E2E_TEST_TOKEN: ${{ secrets.E2E_TEST_TOKEN }}
    steps:
      - uses: ./.github/actions/bootstrap
      - uses: actions/download-artifact@v4
        with: { name: dist, path: . }
      - run: pnpm db:migrate:test && pnpm db:seed:test
      - run: pnpm test:e2e --shard=${{ matrix.shard }}/4
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report-${{ matrix.shard }}, path: e2e/playwright-report }

  visual:
    needs: build
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v1.50.0-jammy
    steps:
      - uses: ./.github/actions/bootstrap
      - uses: actions/download-artifact@v4
        with: { name: dist, path: . }
      - run: pnpm test:visual
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: visual-diffs, path: e2e/visual/test-results }

  bench:
    needs: build
    runs-on: ubuntu-latest-4-core
    steps:
      - uses: ./.github/actions/bootstrap
      - uses: actions/download-artifact@v4
        with: { name: dist, path: . }
      - run: pnpm bench --json=bench-results.json
      - run: node bench/compare.mjs --baseline-ref=${{ github.event.pull_request.base.sha }} --max-regression=0.05
      - uses: actions/upload-artifact@v4
        with: { name: bench-results, path: bench-results.json }

  audit:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/bootstrap
      - run: pnpm audit --audit-level=high --prod
      - run: pnpm licenses list --prod --json > licenses.json && node scripts/check-licenses.mjs
      - uses: github/codeql-action/init@v3
        with: { languages: javascript-typescript }
      - uses: github/codeql-action/analyze@v3
      - run: node scripts/check-secrets-scan.mjs     # gitleaks-style scan of the diff

  docker:
    needs: [build]
    runs-on: ubuntu-latest
    strategy: { matrix: { app: [web, api, sync, worker, runner] } }
    steps:
      - uses: ./.github/actions/bootstrap
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        id: push
        with:
          context: .
          file: infra/docker/${{ matrix.app }}.Dockerfile
          push: ${{ github.event_name == 'push' }}
          tags: ghcr.io/nexus/${{ matrix.app }}:${{ github.sha }}
          provenance: true
          sbom: true
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - uses: aquasecurity/trivy-action@0.24.0
        with:
          image-ref: ghcr.io/nexus/${{ matrix.app }}:${{ github.sha }}
          severity: 'HIGH,CRITICAL'
          exit-code: '1'
          ignore-unfixed: true

  migrate-check:
    needs: setup
    runs-on: ubuntu-latest
    services: { postgres: { image: pgvector/pgvector:pg16, ports: ['5432:5432'], env: { POSTGRES_PASSWORD: test, POSTGRES_USER: nexus, POSTGRES_DB: nexus_test } } }
    steps:
      - uses: ./.github/actions/bootstrap
      - run: pnpm db:migrate:deploy                     # migrations apply cleanly from empty
      - run: pnpm db:migrate:diff --exit-code           # schema == prisma schema (no drift)
      - run: node scripts/check-migration-safety.mjs    # rejects destructive DDL without an expand/contract label
      - run: pnpm db:migrate:shadow-prod                # apply on a restored anonymized staging dump

  ci-ok:
    if: always()
    needs: [lint, typecheck, unit, coverage-gate, build, e2e, visual, bench, audit, docker, migrate-check]
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo '${{ toJSON(needs) }}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const n=JSON.parse(s);const bad=Object.entries(n).filter(([,v])=>v.result!=='success');if(bad.length){console.error('failed:',bad.map(([k])=>k).join(', '));process.exit(1)}})"
```

`ci-ok` is the single required status check, so adding a job never requires touching branch
protection.

Nightly workflow (`.github/workflows/nightly.yml`): 5,000-run property tests, real-tool contract
drift (`18_TESTING.md` §12.2), runner sandbox escape suite, k6 load against staging, ZAP baseline,
cross-browser e2e (firefox, webkit), backup-restore drill (§11), and image rebuild for base-image
CVEs.

---

## 6. Architecture enforcement

`dependency-cruiser` config (`.dependency-cruiser.cjs`) encodes `00_MASTER.md` §5:

| Rule                      | Forbidden                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `no-ui-in-domain`         | `packages/domain` → `apps/web`, `packages/ui`, `react`                                                                             |
| `no-react-in-engine`      | `packages/canvas-engine` → `react`, `react-dom`                                                                                    |
| `no-engine-in-data`       | data layer modules → `packages/canvas-engine`                                                                                      |
| `no-child-process-in-api` | `apps/api` → `child_process`, `node:child_process` (N5)                                                                            |
| `no-direct-graph-write`   | any module except `packages/domain/src/proposal/applyProposal.ts` writing `Y.Map` node/edge roots (N4; ESLint rule, not depcruise) |
| `no-cross-app-import`     | `apps/a` → `apps/b`                                                                                                                |
| `no-circular`             | any cycle                                                                                                                          |
| `no-orphans`              | unreferenced modules outside entrypoints                                                                                           |

---

## 7. Database migration policy

Tool: Prisma Migrate. **Expand/contract only.** A migration may never both add a constraint and
require existing rows to satisfy it in one deploy.

Three-phase change for any breaking schema edit:

1. **Expand** (release _n_): add the new nullable column/table/index (`CREATE INDEX CONCURRENTLY`),
   write to both old and new shapes from the application, read from old.
2. **Backfill** (release _n_, background job): chunked backfill (10k rows per batch, throttled to
   keep replication lag < 5 s), idempotent and resumable, with a progress metric
   `nexus_backfill_rows_total{migration}`.
3. **Contract** (release _n+2_, after the backfill is verified and _n+1_ has been stable for ≥ 7
   days): read from new, drop the old column, add the `NOT NULL`/`FK` constraint using
   `NOT VALID` + `VALIDATE CONSTRAINT`.

Hard rules enforced by `scripts/check-migration-safety.mjs`:

- No `DROP COLUMN` / `DROP TABLE` / `ALTER COLUMN TYPE` / `RENAME` in a migration that is not
  labeled `-- nexus:contract` and accompanied by a comment naming the expand migration it retires.
- No blocking `CREATE INDEX` (must be `CONCURRENTLY`, which also means the migration cannot run in
  a transaction — the file must declare `-- nexus:no-transaction`).
- No `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT <volatile>`.
- Every migration has a stated lock impact and an estimated duration in a header comment.
- Migrations run in a dedicated `migrate` Job **before** new pods roll out; old pods must remain
  compatible with the new schema (this is exactly what expand/contract guarantees).

Rollback: forward-only. A bad migration is fixed by a new migration, never `prisma migrate resolve
--rolled-back` on production. The only rollback that touches data is a PITR restore (§11), and it
is an incident-level decision. Because the CRDT binary snapshot is authoritative for board content
(`00_MASTER.md` §2), the `nodes`/`edges` projection can always be **rebuilt** from snapshots with
`pnpm db:reproject --board=<id>|--all`; projection-only migration errors are therefore recoverable
without data loss and this is the preferred repair path.

---

## 8. Release process, versioning, changelog

- **Trunk-based.** `main` is always releasable. Feature branches: `phase/p<nn>-<slug>` for roadmap
  phases (`20_ROADMAP.md`), `fix/<slug>`, `chore/<slug>`. One phase per PR (`00_MASTER.md` §10.2).
- **Conventional Commits** enforced by commitlint; `changesets` generates the version bump and
  `CHANGELOG.md`.
- **Versioning:** the product ships as one version (`v<major>.<minor>.<patch>`) covering all apps;
  `packages/plugin-sdk` is versioned independently and follows semver strictly because third
  parties depend on it (`17_PLUGIN_SDK.md`).
- **Artifacts:** every merge to `main` builds images tagged `:<sha>`; a release tag `v1.4.2` retags
  the exact digests — images are never rebuilt for a release, so what was tested is what ships.
- **Deploy flow:** `main` → auto-deploy staging → smoke suite (`e2e --grep @smoke`, 8 specs, ≤ 3 min)
  → manual approval → production canary 10 % for 30 min (watch `nexus_http_errors_total`,
  `nexus_frame_p95_ms` from RUM, sync disconnect rate) → 100 %.
- **Rollback:** `kubectl rollout undo` or retagging the previous digest; target ≤ 5 min. Rollback is
  always safe because schema changes are expand-only within a release window (§7).
- **Release notes** are generated from changesets plus a "spec documents changed" section, since a
  spec change is part of the product (`00_MASTER.md` §10.4).

---

## 9. Feature flags

Two mechanisms, deliberately minimal (no third-party service):

1. **Build/deploy flags** — `FEATURE_FLAGS` env csv, read into a typed object at boot:
   `packages/config/src/flags.ts` exports `flags: Record<FlagName, boolean>` where `FlagName` is a
   closed union. Unknown flag names fail the env parse.
2. **Per-org runtime flags** — `feature_flags` table (`org_id`, `flag`, `enabled`, `rollout_pct`,
   `updated_by`, `updated_at`), cached in Redis for 30 s, exposed to the client in the session
   bootstrap payload. Rollout percentage is evaluated by a stable hash of `org_id + flag`.

Rules: a flag has an **owner and an expiry date** recorded in `docs/flags.md`; a flag older than 90
days fails a nightly lint. Flags gate _unfinished_ surfaces (e.g. `views.map`, `ai.suggestLinks`),
never security controls. Flag state is included in error reports and in the support diagnostics
bundle, because "works for me" is usually a flag difference.

Phase mapping: P13 (AI), P14 (views), P15 (presentation/export) ship behind flags enabled first for
internal orgs.

---

## 10. Observability

### 10.1 Traces (OpenTelemetry)

Auto-instrumentation for HTTP, Fastify, Prisma, ioredis, BullMQ, WS; manual spans for the domain
operations that matter:

| Span               | Attributes                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `board.open`       | `board.id`, `node.count`, `edge.count`, `cold`                                                      |
| `board.projection` | `board.id`, `update.bytes`, `rows.upserted`, `rows.deleted`                                         |
| `proposal.apply`   | `proposal.id`, `nodes.created`, `nodes.merged`, `edges.created`                                     |
| `run.execute`      | `tool`, `manifest.version`, `image.digest`, `exit.code`, `duration.ms`, `output.bytes`, `truncated` |
| `unfurl.fetch`     | `url.host`, `redirects`, `bytes`, `blocked.reason`                                                  |
| `ai.completion`    | `provider`, `model`, `tokens.in`, `tokens.out`, `cost.usd`, `proposal.id`                           |
| `search.query`     | `mode` (fts/vector), `results`, `duration.ms`                                                       |
| `export.board`     | `format`, `nodes`, `bytes`                                                                          |

Trace context propagates from the browser (`traceparent` on tRPC calls) so a user-reported slow
action can be opened as one trace. Sampling: 100 % of errors, 100 % of runs and proposals, 10 % of
routine requests, `parentbased_traceidratio`.

### 10.2 Metrics (Prometheus, exposed on `:9464/metrics`)

Concrete names — implementations must use exactly these:

```text
# HTTP / API
nexus_http_requests_total{service,method,route,status}
nexus_http_request_duration_seconds{service,route}          histogram [.01,.05,.1,.25,.5,1,2,5,10]
nexus_http_errors_total{service,route,code}

# Auth
nexus_auth_logins_total{result}
nexus_auth_failed_logins_total{reason}

# Sync
nexus_sync_connections{board_scope}                          gauge
nexus_sync_rooms_open                                        gauge
nexus_sync_update_bytes_total{direction}
nexus_sync_broadcast_latency_seconds                         histogram
nexus_sync_projection_duration_seconds                       histogram
nexus_sync_projection_failures_total{reason}
nexus_sync_doc_memory_bytes{quantile}                        gauge
nexus_sync_awareness_clients                                 gauge

# Documents
nexus_board_snapshot_bytes                                   histogram
nexus_board_nodes                                            histogram
nexus_undo_operations_total{result}

# Jobs
nexus_queue_depth{queue}                                     gauge
nexus_job_duration_seconds{queue,job}                        histogram
nexus_job_failures_total{queue,job,reason}
nexus_job_retries_total{queue,job}

# Runner
nexus_runs_total{tool,status}                                 status=success|failed|timeout|resource_limit|blocked
nexus_run_duration_seconds{tool}                              histogram [1,5,15,30,60,120,300]
nexus_run_output_bytes{tool}                                  histogram
nexus_runner_concurrent_runs                                  gauge
nexus_runner_sandbox_violations_total{kind}                   kind=network|filesystem|caps|pids

# Egress / SSRF
nexus_egress_requests_total{host,allowed}
nexus_ssrf_blocks_total{reason}

# Files
nexus_upload_bytes_total
nexus_upload_rejected_total{reason}
nexus_storage_objects                                         gauge

# AI
nexus_ai_requests_total{provider,model,result}
nexus_ai_tokens_total{provider,model,direction}
nexus_ai_cost_usd_total{org_id}
nexus_ai_budget_remaining_usd{org_id}                         gauge

# Client RUM (pushed via /api/rum, sampled 5 %)
nexus_client_frame_p95_ms{board_size_bucket}
nexus_client_first_interactive_ms
nexus_client_errors_total{kind}
nexus_client_offline_seconds_total

# Database
nexus_db_pool_in_use{service}                                 gauge
nexus_db_query_duration_seconds{op}                           histogram
nexus_migration_pending                                       gauge (0/1)
```

### 10.3 Logs

Pino, JSON, one line per event. Mandatory fields: `ts`, `level`, `service`, `env`, `version`,
`trace_id`, `span_id`, `req_id`, `org_id`, `user_id`, `msg`, `event` (a stable enum like
`run.started`, `proposal.applied`, `authz.denied`). Redaction list covers `password`, `token`,
`authorization`, `cookie`, `apiKey`, `secret`, `AI_API_KEY`, and any value matching secret-shaped
patterns (`18_TESTING.md` §11). Retention: 30 days hot, 12 months for the audit stream
(`15_SECURITY.md` §8), which is a separate append-only sink.

### 10.4 Error tracking

Sentry-compatible SDK (self-hostable GlitchTip works, so self-hosters are not forced into SaaS) in
web, api, sync, worker, runner. Release = the version tag, so stack traces map to sourcemaps
uploaded during the build job and **not** shipped to clients. PII scrubbing before send: no board
content, no node text, no URLs beyond host.

### 10.5 Alerts

| Alert                     | Expression (5 m windows)                                                                                           | Severity | Runbook                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------- |
| `ApiErrorRateHigh`        | `sum(rate(nexus_http_errors_total{status=~"5.."}[5m])) / sum(rate(nexus_http_requests_total[5m])) > 0.02` for 10 m | page     | `runbooks/api-errors.md`                                               |
| `ApiLatencyHigh`          | `histogram_quantile(0.95, nexus_http_request_duration_seconds) > 1` for 10 m                                       | ticket   | `runbooks/api-latency.md`                                              |
| `SyncProjectionFailing`   | `rate(nexus_sync_projection_failures_total[5m]) > 0` for 5 m                                                       | page     | `runbooks/projection.md` (repair: `db:reproject`)                      |
| `SyncBroadcastSlow`       | `histogram_quantile(0.95, nexus_sync_broadcast_latency_seconds) > 1` for 10 m                                      | ticket   | `runbooks/sync.md`                                                     |
| `SyncMemoryHigh`          | `nexus_sync_doc_memory_bytes > 1.5e9`                                                                              | ticket   | `runbooks/sync-memory.md` (evict idle docs)                            |
| `QueueBacklog`            | `nexus_queue_depth > 500` for 15 m                                                                                 | ticket   | `runbooks/queues.md`                                                   |
| `RunFailureRate`          | `sum(rate(nexus_runs_total{status!="success"}[15m])) / sum(rate(nexus_runs_total[15m])) > 0.3`                     | ticket   | `runbooks/runs.md`                                                     |
| `SandboxViolation`        | `increase(nexus_runner_sandbox_violations_total[5m]) > 0`                                                          | **page** | `runbooks/sandbox-violation.md` (isolate node pool, freeze tool image) |
| `SsrfBlockSpike`          | `increase(nexus_ssrf_blocks_total[10m]) > 50`                                                                      | ticket   | `runbooks/ssrf.md` (possible abuse)                                    |
| `AuthBruteForce`          | `increase(nexus_auth_failed_logins_total[5m]) > 100`                                                               | ticket   | `runbooks/auth.md`                                                     |
| `DbPoolSaturation`        | `nexus_db_pool_in_use / DATABASE_POOL_MAX > 0.9` for 10 m                                                          | page     | `runbooks/db.md`                                                       |
| `MigrationPending`        | `nexus_migration_pending == 1` for 15 m                                                                            | page     | `runbooks/migrations.md`                                               |
| `AiBudgetExhausted`       | `nexus_ai_budget_remaining_usd < 5`                                                                                | ticket   | `runbooks/ai-budget.md`                                                |
| `BackupMissing`           | `time() - nexus_backup_last_success_timestamp > 93600` (26 h)                                                      | **page** | `runbooks/backup.md`                                                   |
| `RestoreDrillOverdue`     | drill timestamp older than 35 d                                                                                    | ticket   | `runbooks/dr-drill.md`                                                 |
| `ClientFrameBudgetBreach` | `nexus_client_frame_p95_ms{board_size_bucket="5000+"} > 20` for 30 m                                               | ticket   | `runbooks/canvas-perf.md`                                              |
| `CertExpiry`              | `< 14 d`                                                                                                           | ticket   | `runbooks/tls.md`                                                      |

Every alert must link to a runbook containing: what it means, the three most likely causes, the
first diagnostic query, the mitigation, and the escalation path. An alert without a runbook is
deleted, not muted.

---

## 11. Backup and restore

### 11.1 What is backed up

| Data                              | Method                                                                       | Frequency  | Retention        | RPO                            | RTO            |
| --------------------------------- | ---------------------------------------------------------------------------- | ---------- | ---------------- | ------------------------------ | -------------- |
| Postgres                          | `pgBackRest`/WAL-G: full weekly, incremental daily, WAL streaming continuous | continuous | 35 days PITR     | ≤ 5 min                        | ≤ 60 min       |
| Object storage (files, snapshots) | bucket versioning + cross-region replication                                 | continuous | 35 days versions | ≤ 15 min                       | ≤ 30 min       |
| Redis                             | not backed up (queues/ephemeral fanout) — jobs are recreated from DB state   | —          | —                | n/a                            | n/a            |
| Secrets                           | external secret store's own backup                                           | —          | —                | —                              | ≤ 30 min       |
| Board CRDT snapshots              | stored in Postgres (`board_snapshots.binary`) + S3 copy every 6 h            | 6 h        | 90 days          | ≤ 6 h (S3 copy) / ≤ 5 min (PG) | included above |

Redis holding no durable state is a deliberate design constraint: BullMQ jobs are re-enqueueable
from `runs` rows with status `queued`, and Hocuspocus fanout is stateless. If this ever stops being
true, this table is wrong and must be revised in the same PR.

Backup jobs export `nexus_backup_last_success_timestamp` and `nexus_backup_bytes`; the
`BackupMissing` alert is the only proof that backups work day-to-day.

### 11.2 Restore runbook (`runbooks/backup.md`)

```text
1. Declare the incident; freeze writes: scale api+sync to 0 (users see the maintenance page
   served by caddy/ingress). Record the decision time T0.
2. Choose the recovery target: latest consistent (default) or PITR to a timestamp before the
   corrupting event.
3. Provision a restore instance:
     pgbackrest --stanza=nexus --type=time --target="2026-06-01 12:34:56+00" restore
   Start Postgres in recovery, wait for "consistent recovery state reached".
4. Verify on the restore instance (do NOT point production at it yet):
     - row counts for orgs, projects, boards, nodes, edges within 1 % of the last known good
     - `SELECT max(created_at) FROM audit_log;` matches the target time
     - `pnpm db:verify` (FK integrity, orphan check, snapshot decodability sample of 50 boards)
5. Promote: repoint DATABASE_URL (k8s Secret) → restart api, sync, worker.
6. Reconcile object storage: `pnpm storage:verify --since=<T-24h>` lists DB file rows without an
   object and objects without a row; restore missing objects from versioned copies.
7. Rebuild the projection if any doubt: `pnpm db:reproject --all --concurrency=4`
   (the CRDT snapshots are authoritative; the projection is derived).
8. Re-enable writes: scale api+sync back up; watch ApiErrorRateHigh and SyncProjectionFailing for
   30 min.
9. Post-incident: write the timeline, the actual RPO/RTO achieved, and one preventive action.
```

### 11.3 Disaster recovery drill

Monthly, on staging, restoring **production** backups into an isolated namespace (data is
anonymized on restore by `scripts/anonymize.sql`, which nulls emails, names, node text and file
bodies). The drill is scripted (`infra/dr/drill.sh`) and measured: it must complete within the RTO
with zero manual steps beyond approvals. The drill records `nexus_dr_drill_timestamp` and its
duration; `RestoreDrillOverdue` fires if a drill is skipped. Failure to meet RTO twice in a row is
a blocking production readiness item.

Region loss scenario: infrastructure is described in Terraform (`infra/tf/`), object storage is
cross-region replicated, and Postgres has a cross-region physical replica. Failover is a documented
manual promotion (< 60 min), deliberately not automated — split-brain on a single-writer database
is worse than an hour of downtime for this product.

---

## 12. Data lifecycle and retention

| Data                     | Retention                                      | Deletion                                                       |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------- |
| Board content            | until deleted by the org                       | soft-delete 30 days, then hard purge incl. snapshots and files |
| Run raw payloads         | 90 days (provenance requires the raw artifact) | purge job, provenance keeps a hash + summary                   |
| Audit log                | 12 months                                      | append-only, never edited                                      |
| Uploaded files           | with the board                                 | purge on hard delete, verified by `storage:verify`             |
| Traces                   | 7 days                                         |                                                                |
| Metrics                  | 15 months downsampled                          |                                                                |
| Logs                     | 30 days                                        |                                                                |
| Account deletion request | fulfilled within 30 days                       | tombstone row retained for audit                               |

---

## 13. Capacity planning

Sizing model, derived from measured shapes (validate against real telemetry after GA; these are the
planning numbers, not guarantees):

- **Board memory in `sync`**: a 5,000-node/10,000-edge `Y.Doc` with history ≈ 40–70 MB resident.
  Budget 80 MB per open board. A `sync` pod with a 2 GB limit therefore holds ~20 concurrently open
  large boards, or ~200 typical (200-node) boards. Scale `sync` by _open boards_, not by users;
  the HPA metric is `nexus_sync_rooms_open` with a target of 120 per pod.
- **Idle eviction**: a room with zero clients for 60 s is snapshotted and evicted from memory.
- **Postgres**: ~2.5 KB per node row (jsonb payload included), ~0.4 KB per edge row, plus snapshot
  binaries at roughly 15–25 % of the live doc size per retained snapshot (keep 10 per board + one
  per day for 30 days). 1,000 active boards averaging 800 nodes ≈ 2 GB rows + ~6 GB snapshots.
  Plan 50 GB for the first 1,000 orgs and alert at 70 % disk.
- **pgvector**: 1,536-dim `halfvec` ≈ 3 KB/embedding; embedding 1 M nodes ≈ 3 GB + HNSW index
  ≈ 1.5×. Enable per-org, not globally (P11/P13 flag).
- **Runs**: a Sherlock run is ~20–90 s and ~1 CPU; SpiderFoot scans can run for tens of minutes and
  are capped by `activeDeadlineSeconds`. Concurrency is capped per org (default 3) and per cluster
  (`RUNNER_MAX_CONCURRENCY`, default 4 per runner pod). Size the gVisor pool for
  `peak_concurrent_runs × (1 CPU + 512 MB + 100m/128Mi gVisor overhead)`.
- **Object storage**: assume 8 MB average per board of images/files; 1,000 boards ≈ 8 GB, plus
  versions.
- **Egress proxy**: unfurl bursts dominate (paste of 50 URLs). Rate limit: 10 unfurls/s per org,
  burst 30, queued not dropped.

Growth triggers: add a read replica when `nexus_db_query_duration_seconds` p95 for read ops exceeds
150 ms; move search to a dedicated instance when FTS queries exceed 20 % of DB CPU; split `worker`
queues onto separate deployments when one queue's backlog starves another (BullMQ groups first,
separate deployments second).

---

## 14. Production readiness checklist

Must be fully ticked before GA (this is P16's exit criteria in `20_ROADMAP.md`):

```markdown
**Security**

- [ ] `NEXUS_TEST_ENDPOINTS=false` verified in production config; boot guard test green
- [ ] All tool images pinned by digest; `RUNNER_ALLOW_UNSANDBOXED` unset; gvisor RuntimeClass present
- [ ] Network policies applied; default-deny verified by an in-cluster probe pod
- [ ] Cloud metadata endpoint unreachable from every workload (tested)
- [ ] Secrets from the external store only; no secret in any ConfigMap or image layer (scanned)
- [ ] CSP, HSTS, nosniff, frame-ancestors none verified on the live domain
- [ ] Authz matrix test green; penetration test findings triaged (`15_SECURITY.md`)
- [ ] Dependency and image scans clean of HIGH/CRITICAL (or documented exceptions with expiry)

**Reliability**

- [ ] Backups running; last restore drill within 35 days and inside RTO
- [ ] PITR verified to a random timestamp in the last 7 days
- [ ] `db:reproject` validated on a 5,000-node board
- [ ] HPA/KEDA limits set; PodDisruptionBudgets present; rolling update maxUnavailable=0
- [ ] Graceful shutdown: SIGTERM drains WS connections with a client-side reconnect within 5 s
- [ ] Migration safety script enforced; last 10 migrations reviewed for expand/contract compliance

**Performance**

- [ ] N1 budget green on the release tag; bench baseline recorded
- [ ] k6 scenarios meet thresholds on staging at 2× expected peak
- [ ] Bundle budget met; assets immutable+CDN-cached; `index.html` no-store

**Observability**

- [ ] Every metric in §10.2 emitted (checked by `scripts/check-metrics.mjs` against a live scrape)
- [ ] Every alert in §10.5 has a runbook file that exists and is non-empty
- [ ] Traces propagate browser → api → sync → runner on a sample journey
- [ ] Error tracking receives a deliberate test error with correct release and sourcemaps

**Product/UX**

- [ ] Quality gate (`00_MASTER.md` §8) passed on every phase P1–P16
- [ ] a11y sweep zero violations; keyboard-only journeys pass
- [ ] Status page, maintenance page, and a user-visible incident banner mechanism exist
- [ ] Data export works for a 5,000-node board within 30 s (user right to their data)
- [ ] Acceptable-use notice and legal copy shipped (`15_SECURITY.md` §9)

**Operations**

- [ ] On-call rotation and escalation defined; paging tested end-to-end
- [ ] Self-host compose verified from scratch on a clean host in ≤ 15 min following `README`
- [ ] Version, changelog and upgrade notes published; rollback rehearsed on staging
```

---

## Open risks

1. **Runner needs a container runtime.** In compose, mounting a docker socket (even read-only) is a
   privilege concentration. Mitigation: rootless docker socket, runner runs as an unprivileged user
   with a socket proxy restricting the API surface to container create/start/logs/remove; the
   Kubernetes path (Job API + RBAC) is the recommended production topology and avoids the socket
   entirely. Revisit if a rootless CRI shim becomes standard.
2. **gVisor availability.** Managed Kubernetes offerings vary in RuntimeClass support; if the target
   cluster lacks it, tool execution must move to dedicated nodes with Kata or a separate VM pool.
   The fallback (`RUNNER_ALLOW_UNSANDBOXED`) is deliberately loud and must never be default.
3. **SpiderFoot maintenance risk.** deps.dev (June 2026) shows no upstream activity in 90 days for
   `smicallef/spiderfoot`. Pinned digests will accumulate unpatched CVEs; Trivy will flag them.
   Mitigation: isolate behind the adapter, keep the manual CSV import fallback, and be prepared to
   drop the integration without touching the core (it is manifest-driven by design).
4. **Sync memory model unvalidated at scale.** The 80 MB/board budget is an estimate; if real docs
   are heavier, `sync` cost grows fastest. Mitigation: `nexus_sync_doc_memory_bytes` is measured
   from day one, eviction is aggressive, and the HPA metric can switch from rooms to bytes.
5. **Single-writer Postgres.** Vertical scaling has a ceiling and failover is manual. Acceptable at
   the planned scale; revisit with a managed HA offering before 10k active orgs.
6. **Preview environments leak cost and data.** Per-PR namespaces with real S3 buckets can be
   forgotten. Mitigation: 72 h TTL reaper job, `preview` overlay hard-limits resources, and preview
   data is always seeded, never restored from production.
7. **Perf runner class.** `ubuntu-latest-4-core` may still be too noisy for a 5 % gate (see
   `18_TESTING.md` §9.2 risk). Budget for a self-hosted perf runner before P16.
