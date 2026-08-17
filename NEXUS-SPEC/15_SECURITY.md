# NEXUS — 15 — SECURITY

## Scope

The complete security specification for NEXUS: threat model and attack trees, authentication
(Better-Auth), authorization (org/project/board RBAC with enforcement points and Postgres tenant
isolation), boundary input validation and HTML sanitization, SSRF defense for unfurl/fetch, file
security, the tool sandbox, secrets management, headers/CSP/supply chain, the audit log, data
protection, and acceptable-use enforcement. Binding on every phase; §4 (SSRF) satisfies N7,
§6 satisfies N5 (`00_MASTER.md` §4). Cross-refs: `10_INTEGRATIONS.md` (runner pipeline),
`14_AI_AGENT.md` (§7 AI guardrails), `09_BACKEND.md` (services), `19_DEPLOYMENT.md` (infra).

---

## 1. Threat model

### 1.1 Assets (ranked by impact of loss)

| # | Asset | Where it lives | Impact if compromised |
|---|---|---|---|
| A1 | Investigation graphs (nodes, edges, notes) | Postgres `nodes`/`edges`, Yjs binary, S3 blobs | Exposure of an ongoing investigation; harm to subjects and to the analyst |
| A2 | Integration credentials (GitHub PAT, provider API keys, SpiderFoot API keys) | `integration_credentials` (envelope-encrypted) | Lateral compromise of the user's third-party accounts |
| A3 | Uploaded files and fetched page snapshots | S3/MinIO, separate origin | Leak of source material; malware redistribution |
| A4 | Session material (cookies, device sessions) | browser + Postgres `session` | Account takeover |
| A5 | Tool run outputs (Sherlock/SpiderFoot results) | `integration_runs`, S3 raw payloads | Reveals targets and methodology |
| A6 | Audit log | Postgres `audit_events` (append-only) | Loss of accountability; covering tracks |
| A7 | Infrastructure (runner host, DB, egress proxy) | k8s / compose | Full compromise, pivot into the operator's network |
| A8 | Share links and exports | signed URLs, generated PDFs/archives | Uncontrolled disclosure |

### 1.2 Actors and capabilities

| Actor | Position | Capabilities assumed | Motivation |
|---|---|---|---|
| **T1 Curious user** | authenticated, low privilege | can call any API with own session, can guess ids, can read client bundle | see other projects, escalate role |
| **T2 Malicious collaborator** | invited editor/viewer in one project | full API surface for that project, can upload files, can invite? (no), can export | exfiltrate, sabotage, plant misleading evidence |
| **T3 Hostile fetched content** | data | crafted HTML/PDF/SVG/JSON that NEXUS parses, renders or sends to the model | XSS, SSRF, parser RCE, prompt injection, resource exhaustion |
| **T4 Malicious plugin** | third-party code, user-installed | plugin manifest permissions, host API calls | steal graph data, exfiltrate credentials, abuse egress |
| **T5 Compromised tool image** | container we execute | arbitrary code inside the sandbox | escape, exfiltrate, crypto-mine, pivot |
| **T6 Network attacker** | on-path or same cluster | intercept, DNS spoof, connect to internal services | credential theft, SSRF pivot |
| **T7 Malicious anonymous visitor** | holds a share link | read a shared board | mass scraping, link enumeration |
| **T8 Insider operator** | infra access | read DB/S3, alter logs | undetected data access |

### 1.3 Trust boundaries

```text
[browser] ──TLS──▶ [edge/ingress] ──▶ [api] ──▶ [postgres] [redis] [s3]
                                   ├──▶ [sync (hocuspocus)]
                                   └──▶ [worker] ──▶ [egress-proxy] ──▶ internet
                                                 └──▶ [runner] (separate network ns, no API access)
```

Rules that define the boundaries:
- The **runner** can reach only the egress proxy and its own result-upload endpoint (a dedicated,
  mTLS-authenticated ingest port on the worker). It **cannot** reach Postgres, Redis, S3 or the API.
- The **worker** and **api** never make outbound requests directly; all egress goes through the proxy.
- The **browser** never receives S3 credentials; all object access is presigned and scoped.
- Untrusted **rendered** content lives only in a sandboxed iframe on a separate origin (§3.4).

### 1.4 Attack trees for the top 8 threats

Notation: `└─` = child step; `[C-n]` = control id from §1.5.

**AT-1 — Cross-tenant read of another org's project (T1, T2)**
```
Goal: read project P of org O2 while authenticated in O1
├─ Guess project id in a tRPC call                 → [C-1] authz middleware resolves org from resource, not from input
├─ Tamper with orgId in request body               → [C-1] orgId never read from the body; derived from session + membership
├─ Join a board room in the sync server by boardId  → [C-2] Hocuspocus onAuthenticate resolves board→project→membership
├─ Presign a storage object of another org         → [C-3] presign requires object key prefix = orgId/projectId and an ACL check
├─ SQL injection into a raw query                  → [C-4] Prisma parameterization + no string-built SQL + RLS
└─ Read a stale share token                        → [C-5] tokens are per-board, revocable, expiring, and scoped read-only
```

**AT-2 — Stored XSS via fetched or pasted content (T3)**
```
Goal: run JS in a victim's session on the app origin
├─ Paste HTML into a rich-text node                → [C-6] editor stores a restricted ProseMirror schema, not raw HTML
├─ Unfurl returns HTML/SVG rendered inline          → [C-7] previews are text+image only; HTML previews only in sandboxed iframe
├─ SVG upload rendered as <img>                     → [C-8] SVG is rasterized server-side or served with CSP sandbox headers
├─ Markdown link javascript:                        → [C-9] URL scheme allowlist at render (http/https/mailto only)
├─ Node title with <script>                         → [C-10] React text nodes, zero dangerouslySetInnerHTML outside the sanitizer
└─ Injected event handler via DOMPurify bypass      → [C-11] DOMPurify with strict allowlist + CSP without unsafe-inline as backstop
```

**AT-3 — SSRF to cloud metadata / internal service (T2, T3)**
```
Goal: make NEXUS fetch http://169.254.169.254/… or an internal admin panel
├─ Direct private IP URL                            → [C-12] parsed-host + resolved-IP denylist
├─ Hostname resolving to 127.0.0.1 / RFC1918        → [C-12] DNS resolution check before connect
├─ DNS rebinding (TTL 0, second resolution differs) → [C-13] connect to the pinned validated IP, not to the hostname
├─ 302 redirect to internal after a public first hop→ [C-14] every hop re-validated, max 3 hops
├─ Non-HTTP scheme (file:, gopher:, ftp:)           → [C-15] scheme allowlist
├─ IPv6 loopback / IPv4-mapped ::ffff:127.0.0.1     → [C-12] normalized to v4 before check; v6 ULA/link-local denied
├─ Bypass via the egress proxy                      → [C-16] proxy enforces the same denylist independently
└─ Huge/slow response as DoS                        → [C-17] 10 MB cap, 10 s connect / 20 s total, streaming abort
```

**AT-4 — Container escape from a tool run (T5)**
```
Goal: execute code on the runner host
├─ Kernel exploit via syscall                       → [C-18] gVisor runtimeClass in prod + seccomp default-deny profile
├─ Privileged capability abuse                      → [C-19] --cap-drop ALL, no-new-privileges, non-root uid 65532
├─ Write to a host mount                            → [C-20] no host mounts at all; --read-only rootfs + tmpfs workdir
├─ Docker socket access                             → [C-21] runner never mounts /var/run/docker.sock; uses the k8s Job API with a
│                                                       narrow RBAC role, or rootless podman in the compose reference
├─ Fork bomb / memory exhaustion                    → [C-22] --pids-limit 256, mem 1 GiB, cpu 1.0, hard timeout
└─ Network pivot to Postgres                        → [C-23] NetworkPolicy: runner egress = proxy only; API/DB deny ingress from runner
```

**AT-5 — Credential exfiltration (T2, T4, T5)**
```
Goal: obtain a stored GitHub PAT
├─ Read it from the API response                    → [C-24] credentials are write-only over the API; never returned, ever
├─ Read it from the DB dump                         → [C-25] envelope encryption with a KMS-held root key; DB dump alone is useless
├─ Read it from process args of a tool run          → [C-26] secrets injected as tmpfs files + env from file, never argv
├─ Read it from logs                                → [C-27] redaction middleware on every logger + a CI grep test on fixtures
├─ Plugin requests it                               → [C-28] plugins never receive raw secrets; the host performs the auth’d call
└─ Steal it via the egress proxy                    → [C-29] proxy allowlist per integration; unexpected host = blocked + alert
```

**AT-6 — Session/account takeover (T1, T6)**
```
Goal: act as another user
├─ Steal cookie via XSS                             → AT-2 controls + [C-30] HttpOnly, SameSite=Lax, Secure, __Host- prefix
├─ CSRF on a state-changing endpoint                → [C-31] SameSite=Lax + Origin check + double-submit token on non-tRPC routes
├─ Session fixation                                 → [C-32] session id rotated on login and on privilege change
├─ Brute force password                             → [C-33] per-account + per-IP rate limits, argon2id, generic error copy
├─ Bypass 2FA                                       → [C-34] TOTP verified server-side, backup codes single-use hashed, rate-limited
└─ Long-lived stolen session                        → [C-35] 30-day absolute / 7-day idle expiry, device list with remote revoke
```

**AT-7 — Malicious plugin (T4)**
```
Goal: exfiltrate the whole graph
├─ Read all boards via host API                     → [C-36] host API is capability-scoped to the current board + declared perms
├─ Direct fetch() to attacker server                → [C-37] plugin runs in a Worker with a CSP connect-src of declared hosts only
├─ Ask the user for broad permissions               → [C-38] permission prompt lists concrete effects; least-privilege defaults
├─ DOM access to steal cookies                      → [C-39] plugins have no DOM on the app origin; UI is a sandboxed iframe
└─ Persist beyond uninstall                         → [C-40] plugin storage is namespaced and purged on uninstall
```

**AT-8 — Evidence tampering / repudiation (T2, T8)**
```
Goal: alter the investigation record undetectably
├─ Edit a node and deny it                          → [C-41] audit event per mutation with actor, before/after hash
├─ Delete audit rows                                → [C-42] append-only table (no UPDATE/DELETE grant), hash-chained
├─ Alter the exported report                        → [C-43] export manifest with per-file sha256 + optional detached signature
├─ Replace a stored file                            → [C-44] object keys are content-addressed (sha256) and immutable
└─ Backdate an entry                                → [C-45] server-assigned timestamps only; client time never persisted as truth
```

### 1.5 Control catalogue (mapping)

| Control | Implementation location | Verified by |
|---|---|---|
| C-1 authz middleware | `apps/api/src/trpc/middleware/authz.ts` | unit + e2e cross-tenant suite |
| C-2 sync auth hook | `apps/sync/src/auth.ts` | e2e (join foreign room → 4401) |
| C-3 presign ACL | `apps/api/src/files/presign.ts` | unit |
| C-4 no raw SQL / RLS | `packages/db` + migrations | CI grep + RLS test |
| C-5 share tokens | `apps/api/src/share/*` | e2e |
| C-6 editor schema | `apps/web/src/features/richtext/schema.ts` | unit |
| C-7/C-8 preview isolation | `apps/web/src/features/preview/SandboxFrame.tsx` | Playwright |
| C-9/C-10/C-11 sanitizer | `packages/domain/src/sanitize.ts` | XSS corpus test |
| C-12…C-17 SSRF guard | `packages/domain/src/net/safeFetch.ts` + proxy | hostile URL corpus (N7) |
| C-18…C-23 sandbox | `apps/runner` + `infra/k8s/runner.yaml` | architecture test + escape suite |
| C-24…C-29 secrets | `apps/api/src/secrets/*`, runner injector | unit + log grep test |
| C-30…C-35 auth | Better-Auth config `apps/api/src/auth.ts` | e2e |
| C-36…C-40 plugin sandbox | `packages/plugin-sdk` + host | see `17_PLUGIN_SDK.md` §6 |
| C-41…C-45 audit/integrity | `apps/api/src/audit/*` | integrity verifier job |

---

## 2. Authentication

### 2.1 Better-Auth configuration

`apps/api/src/auth.ts` (single source; the web app only consumes it):

```ts
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: env.PUBLIC_APP_URL,                     // exact origin, no wildcards
  trustedOrigins: [env.PUBLIC_APP_URL],            // used for CSRF origin checks
  secret: env.AUTH_SECRET,                         // 32+ bytes, from the secret store, rotated yearly
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: true,
    password: { hash: argon2id({ memoryCost: 19456, timeCost: 2, parallelism: 1 }) },
  },
  socialProviders: {
    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, scope: ["read:user"] },
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  },
  account: { accountLinking: { enabled: true, trustedProviders: ["github", "google"] } },
  session: {
    expiresIn: 60 * 60 * 24 * 30,                  // absolute 30 days
    updateAge: 60 * 60 * 24,                       // sliding refresh at most daily
    freshAge: 60 * 15,                             // re-auth required for sensitive ops older than 15 min
    cookieCache: { enabled: false },               // sessions are DB-authoritative → instant revocation
  },
  advanced: {
    useSecureCookies: true,
    cookiePrefix: "__Host-nexus",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
    ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] }, // trusted proxy only
  },
  rateLimit: { enabled: true, window: 60, max: 20, storage: "secondary-storage" }, // Redis
  plugins: [
    twoFactor({ issuer: "NEXUS", skipVerificationOnEnable: false, backupCodes: { amount: 10, length: 10 } }),
    organization({ allowUserToCreateOrganization: true, membershipLimit: 500 }),
    // device sessions: multi-session plugin gives one row per device, each revocable
    multiSession({ maximumSessions: 10 }),
  ],
});
```

**Adapter assumption:** plugin names/options above reflect the Better-Auth API surface we target; if a
plugin option differs at implementation time, the *behavior* specified in §2.2–§2.6 is the contract
and the config must be adjusted to satisfy it, not the other way round.

### 2.2 Session handling

- Session records live in Postgres (`session` table: `id`, `userId`, `token` hash, `expiresAt`,
  `ipAddress`, `userAgent`, `deviceLabel`, `lastActiveAt`, `mfaSatisfiedAt`). No JWT is used for app
  auth: instant revocation matters more than statelessness at our scale.
- Idle timeout 7 days (`lastActiveAt`), absolute 30 days. Both enforced server-side on every request;
  the client is never trusted to expire anything.
- Session id is regenerated on: login, 2FA completion, password change, email change, role change.
- Concurrent sessions capped at 10 per user; the oldest is evicted with an audit event and an email.
- **Sync tokens:** the WebSocket cannot send cookies cross-origin reliably, so the client calls
  `POST /api/sync-ticket` (cookie-authenticated) and receives a **single-board, 60-second, one-time**
  JWT (`aud: "sync"`, `sub: userId`, `bid: boardId`, `role`). Hocuspocus verifies it in
  `onAuthenticate` and then re-checks membership in the DB (defense in depth; the ticket alone is not
  authorization). Ticket ids are stored in Redis with a 60 s TTL to enforce one-time use.

### 2.3 Cookie flags

| Cookie | Flags | Purpose |
|---|---|---|
| `__Host-nexus.session_token` | HttpOnly, Secure, SameSite=Lax, Path=/, no Domain | session |
| `__Host-nexus.csrf` | Secure, SameSite=Lax, Path=/, **not** HttpOnly | double-submit token for non-tRPC POST routes |
| `nexus.theme` | not HttpOnly, SameSite=Lax | UI preference only, never security-relevant |

`__Host-` prefix forbids a `Domain` attribute and requires `Secure` + `Path=/`, which removes
subdomain-injection cookie shadowing. Storage/preview origins never receive the session cookie
because they are different registrable hosts (§5.6).

### 2.4 CSRF strategy

Layered:
1. `SameSite=Lax` blocks cross-site POSTs from a plain form/link.
2. **Origin/Referer check** on every state-changing request (`POST/PUT/PATCH/DELETE` and all tRPC
   mutations): `Origin` must equal `PUBLIC_APP_URL`; missing `Origin` on a mutation → reject.
3. tRPC mutations require the header `x-nexus-client: web` (a custom header cannot be set by a
   simple cross-site form; it forces a preflight, which CORS denies).
4. Non-tRPC REST routes used by browsers additionally validate the double-submit token
   (`x-csrf-token` header == `__Host-nexus.csrf` cookie, constant-time compare).
5. Plugin/webhook REST API (machine clients) uses bearer API keys and is exempt from CSRF but is
   **not** cookie-authenticated — cookies are ignored on `/api/v1/*` entirely, which is what makes
   the exemption safe.
6. CORS: `Access-Control-Allow-Origin` is the exact app origin, `credentials: true`, methods and
   headers explicitly listed; no wildcard, no reflection of arbitrary origins.

### 2.5 Two-factor authentication

- TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 window), secret stored envelope-encrypted (§7).
- Enrollment requires verifying one code before activation; 10 backup codes shown once, stored as
  argon2id hashes, single-use, regenerable.
- WebAuthn is a phase-16 extension; the schema reserves `two_factor.method` for it.
- Verification attempts: 5 per 15 min per user, then 15 min lockout of 2FA verification only (never
  lock the whole account — that is a DoS vector).
- Org policy `require2fa` (owner-settable): members without 2FA can authenticate but every request is
  routed to an enrollment wall; only `auth.*` and `me.*` endpoints are permitted until enrolled.
- Sensitive operations (change password/email, create API key, reveal share-link admin settings,
  rotate integration credentials, delete project/org, export full archive) require **fresh auth**:
  `mfaSatisfiedAt` within 15 min, else step-up prompt.

### 2.6 Device sessions UI

Settings → Security lists each session: device label (parsed UA, truncated), IP (coarse, /24 for v4),
approximate location from IP (optional, disabled by default), created, last active, "this device"
badge, and **Revoke**. "Sign out everywhere" revokes all but the current session and forces re-login
on the next request elsewhere within 5 s (sessions are checked per request). Each revoke writes an
audit event and, if it revokes ≥ 3 sessions, sends a notification email.

### 2.7 Account lifecycle security

- Registration: email verification link, 30-minute single-use token, hashed at rest.
- Password reset: 15-minute single-use token; response is identical whether the email exists or not;
  reset invalidates all sessions and all API keys.
- Email change: confirmation sent to both old and new addresses; the old address gets an undo link
  valid 72 h.
- Deletion: soft-delete with a 30-day grace, then hard delete (see §11.4 and `19_DEPLOYMENT.md` §8 for
  backup expiry interaction).

---

## 3. Authorization

### 3.1 Model

```text
Organization ──has many──► Members (role: owner | admin | member | guest)
     │
     └── Projects ──has many──► Boards ──has many──► Nodes/Edges
                │
                └── ProjectMembers (role: project_admin | editor | commenter | viewer)
```

Effective role = `max(orgRole→projectRole mapping, explicit projectMember role)`.
Org `owner`/`admin` map to `project_admin` on every project in the org; `member` gets **no** implicit
project access (explicit grant required); `guest` can only be granted per-project and never sees the
org member list. This makes the default deny-by-default rather than org-wide-open.

Board-level: boards inherit the project role. An optional per-board restriction
(`board_restrictions(board_id, user_id, role)`) can *narrow* a user's access to `viewer` or `none` for
sensitive boards; it can never *widen* it.

### 3.2 RBAC matrix

Actions: C=create, R=read, U=update, D=delete, X=execute, S=share, E=export.

| Resource | org owner | org admin | project_admin | editor | commenter | viewer | share-link (anon) |
|---|---|---|---|---|---|---|---|
| Organization settings | CRUD | RU | – | – | – | – | – |
| Org members / roles | CRUD | CRU (not owner) | – | – | – | – | – |
| Billing / AI budgets | CRUD | R | R (project budget U) | – | – | – | – |
| Project | CRUD | CRUD | RU, D own | R | R | R | – |
| Project members | CRUD | CRUD | CRUD (≤ own role) | – | – | – | – |
| Project scope/consent records | CRUD | CRUD | CRUD | R | R | R | – |
| Board | CRUD | CRUD | CRUD | CRU | R | R | R (if link grants) |
| Node / Edge | CRUD | CRUD | CRUD | CRUD | R | R | R |
| Comment | CRUD | CRUD | CRUD | CRUD | CRU own | R | – |
| File upload | C | C | C | C | – | – | – |
| File download | R | R | R | R | R | R | R (if link grants files) |
| Integration credential | CRUD (write-only read) | CRUD | CRUD | – | – | – | – |
| Integration run | X, R | X, R | X, R | X, R | R | R | – |
| AI run (read-only caps) | X | X | X | X | X | X | – |
| AI run (write caps) | X | X | X | X | – | – | – |
| Apply proposal | X | X | X | X | – | – | – |
| Export board/report | E | E | E | E | E | E (if allowExport) | E (if link grants) |
| Share link create/revoke | S | S | S | – | – | – | – |
| Audit log (project) | R | R | R | R own | R own | R own | – |
| Plugin install (org) | CRUD | CRUD | – | – | – | – | – |
| Delete org / project | D | D (project) | D own project | – | – | – | – |

Rules encoded once in `packages/domain/src/authz/policy.ts` as a pure function
`can(actor: Actor, action: Action, resource: ResourceRef): Result` with an exhaustive switch, so the
matrix above is testable line by line (`policy.spec.ts` asserts every cell).

### 3.3 Enforcement points

1. **tRPC middleware** (`apps/api/src/trpc/middleware/authz.ts`) — every procedure declares
   `.meta({ action: "board.update", resource: "board" })`; the middleware loads the resource,
   resolves org/project from the **resource row** (never from the client payload), and calls `can()`.
   A procedure without `meta.action` fails to compile (type-level `assertMeta`) — no accidental
   unprotected route.
2. **Sync auth hook** (`apps/sync/src/auth.ts`) — `onAuthenticate` verifies the sync ticket, loads
   membership, and returns `{ user, role }`; `readOnly: true` is set for `viewer`/`commenter` so
   Hocuspocus rejects their updates at the protocol level. `onStoreDocument` re-checks the role before
   projecting. Awareness payloads are filtered to `{ userId, name, color, cursor }` only.
3. **Storage presigning** (`apps/api/src/files/presign.ts`) — object keys are
   `org/<orgId>/proj/<projectId>/<sha256>` and the presigner asserts the caller can access that
   project; upload presigns are POST-policy limited by content-length range and expire in 5 min;
   download presigns expire in 5 min and are single-purpose (no `PUT`).
4. **REST v1 (plugins/webhooks)** — API keys carry an explicit scope set
   (`project:<id>:read`, `board:<id>:write`, …); the same `can()` function evaluates them by mapping
   the key to a synthetic actor.
5. **Worker/runner jobs** — every job payload carries `actorId` and is re-authorized before it writes;
   a job whose actor lost access between enqueue and execution fails with `forbidden` and is logged.
6. **Client-side checks are UX only.** Hidden buttons are never a control; every hidden action is also
   denied server-side, asserted by an e2e "viewer tries every mutation" suite.

### 3.4 Tenant isolation in Postgres

Defense in depth beyond the application layer:

```sql
ALTER TABLE nodes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges            ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards           ENABLE ROW LEVEL SECURITY;
ALTER TABLE files            ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chunks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs          ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nodes
  USING (project_id = current_setting('nexus.project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('nexus.project_id', true)::uuid);
-- identical policy per table; boards/files/... use their own project_id column
```

Every request runs its queries inside a transaction that first executes
`SELECT set_config('nexus.project_id', $1, true)` (transaction-local). The Prisma client is wrapped by
`withProject(projectId, fn)` in `packages/db/src/tenant.ts`; a raw `prisma.$queryRaw` outside that
wrapper is blocked by an ESLint rule. Cross-project reads (global search, admin) use a separate
`nexus_admin` role with `BYPASSRLS` and are limited to three audited code paths, each of which filters
by the caller's membership list explicitly.

Additional invariants:
- Every tenant table has a `project_id` column, NOT NULL, indexed, with an FK cascade.
- Composite unique keys always include `project_id` so ids cannot collide across tenants.
- Backups and exports are per-org; the export job runs under the tenant role, not the admin role.

---

## 4. Input validation and safe rendering

### 4.1 Boundary table

| Boundary | Validator | Failure behavior |
|---|---|---|
| tRPC input | zod schema per procedure, `strict()` objects | 400 with field-level errors; never echo the raw value back |
| REST v1 | zod via OpenAPI schema, body ≤ 1 MB | 400 problem+json |
| WebSocket (Yjs) | structural: only Yjs protocol messages; document-level invariants re-validated at projection | invalid update → reject + disconnect + audit |
| Projection (sync → Postgres) | `zNode`/`zEdge` from `packages/domain`; unknown node type → quarantine row, not a crash | quarantined + logged |
| File upload | §5 | 415 / 413 |
| URL input (unfurl, integrations) | §4.2 + §6 | typed `UrlRejected` reason shown to the user |
| Tool output parsing | zod per parser + size caps before parse | run marked `parse_failed`, raw payload retained |
| AI output | zod + citation validation (`14_AI_AGENT.md` §7.2) | items dropped |
| Import (board JSON) | schema version check + zod + id remapping + cycle/size limits | import refused with a diff of what failed |
| Env config | zod at boot (`packages/config/env.ts`) | process exits non-zero |

Global limits: JSON body 1 MB (imports use a separate multipart endpoint, 100 MB), array lengths
capped in every schema (no unbounded `z.array`), string lengths capped (titles 512, text 2 MB),
`z.string().url()` never used alone — always followed by the URL policy in §4.2.

### 4.2 URL policy (parsing layer)

```ts
export function parseUserUrl(raw: string): Result<URL, UrlRejection> {
  if (raw.length > 2048) return err("too_long");
  const u = tryParse(raw.trim());                       // WHATWG URL
  if (!u) return err("unparseable");
  if (!["http:", "https:"].includes(u.protocol)) return err("scheme_not_allowed");
  if (u.username || u.password) return err("credentials_in_url");
  if (u.hostname.endsWith(".onion") && !env.ALLOW_ONION) return err("onion_disabled");
  if (isIpLiteral(u.hostname) && isPrivateIp(normalizeIp(u.hostname))) return err("private_address");
  if (u.port && !["", "80", "443", "8080", "8443"].includes(u.port)) return err("port_not_allowed");
  return ok(u);
}
```

Rendering a URL anywhere in the UI uses `safeHref()` which re-applies the scheme allowlist and adds
`rel="noopener noreferrer nofollow"` and `target="_blank"`. Punycode/homograph: display uses the
Unicode form with a "⚠ mixed-script domain" badge when the host mixes scripts; the underlying href
always uses the ASCII (punycode) form.

### 4.3 HTML sanitization

Untrusted HTML appears in three places: pasted rich text, unfurl descriptions, and imported notes.

`packages/domain/src/sanitize.ts`:

```ts
export const SANITIZE_PROFILE = {
  ALLOWED_TAGS: ["p","br","strong","em","u","s","code","pre","blockquote",
                 "ul","ol","li","h1","h2","h3","h4","a","img","hr","table","thead","tbody","tr","th","td"],
  ALLOWED_ATTR: ["href","title","alt","src","colspan","rowspan","start","lang","dir"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/(?:png|jpeg|gif|webp);base64,)/i,
  FORBID_TAGS: ["script","style","iframe","object","embed","form","input","button","svg","math","link","meta","base"],
  FORBID_ATTR: ["style","srcset","formaction","form","ping","integrity","nonce"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  KEEP_CONTENT: false,
  RETURN_DOM: false,
  USE_PROFILES: { html: true },   // no SVG, no MathML profiles → mXSS surface removed
};
```

Hardening beyond the config:
- A DOMPurify hook (`afterSanitizeAttributes`) forces `target="_blank"` + `rel` on anchors, strips any
  `href` that is not http/https/mailto after normalization, and rewrites `img[src]` to the image proxy
  (§5.7) so remote loads cannot leak the reader's IP.
- Sanitization happens **server-side on ingest** (stored clean) *and* client-side on render
  (defense in depth against a compromised stored value or an older record).
- The rich-text editor does not store HTML at all: it stores a ProseMirror JSON document restricted to
  the schema above; HTML is only an import/export format. This removes most mXSS classes structurally.
- `dangerouslySetInnerHTML` is forbidden by ESLint (`react/no-danger: error`) with a single allowed
  file: the sanitized-render component, which asserts the value came from `sanitize()` via a branded
  type `SanitizedHtml`.

### 4.4 Safe rendering of untrusted previews

- **Text/metadata previews** (title, description, favicon, og:image) are rendered as plain React text
  and an `<img>` through the image proxy. This is the default and covers 95% of cases.
- **Full page snapshots / HTML previews** render only inside:

```html
<iframe
  src="https://preview.<app-domain>/p/<snapshotId>?t=<token>"
  sandbox="allow-scripts"            <!-- NEVER allow-same-origin together with allow-scripts -->
  referrerpolicy="no-referrer"
  loading="lazy"
  csp="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'"></iframe>
```

  `allow-scripts` without `allow-same-origin` gives the frame an opaque origin: it cannot read cookies,
  localStorage, or the parent DOM. The preview origin is a **separate registrable domain** (or at least
  a separate host that never receives the session cookie) and serves its own strict CSP header
  (`default-src 'none'; img-src data: blob: https://preview-assets…; style-src 'unsafe-inline'`).
  postMessage from the frame is accepted only for a `{type:"resize",height:number}` message, validated
  and clamped to 200–4000 px.
- **PDF previews** use a pre-rendered page image (rasterized in the worker, §5.5), never a PDF viewer
  on the app origin.

### 4.5 Application CSP

Served by the API/ingress for the app origin:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://img.<app-domain>;
  media-src 'self' blob:;
  font-src 'self';
  connect-src 'self' wss://sync.<app-domain> https://api.<app-domain>;
  frame-src https://preview.<app-domain>;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'none';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
  report-uri /api/csp-report
```

`'unsafe-inline'` for styles is accepted because the design system emits inline custom-property values
on canvas nodes; script has no `unsafe-inline` and no `unsafe-eval` (`wasm-unsafe-eval` only, needed
for the layout/edge-routing WASM worker). Reports are sampled at 5% and aggregated.

---

## 5. SSRF defense in depth (N7)

Every outbound HTTP request triggered by user data — unfurl, favicon, og:image, repo README fetch,
integration webhooks, plugin egress — goes through `safeFetch()` **and** the egress proxy. Neither is
sufficient alone: the library protects the app process, the proxy protects against library bugs and
against code paths that forget the library.

### 5.1 Layer 1 — `safeFetch`

`packages/domain/src/net/safeFetch.ts`:

```ts
const DENY_V4 = [
  "0.0.0.0/8","10.0.0.0/8","100.64.0.0/10","127.0.0.0/8","169.254.0.0/16",
  "172.16.0.0/12","192.0.0.0/24","192.0.2.0/24","192.168.0.0/16","198.18.0.0/15",
  "198.51.100.0/24","203.0.113.0/24","224.0.0.0/4","240.0.0.0/4","255.255.255.255/32",
];
const DENY_V6 = ["::/128","::1/128","fc00::/7","fe80::/10","ff00::/8","2001:db8::/32","64:ff9b::/96"];

export interface SafeFetchOpts {
  maxRedirects?: number;   // default 3
  maxBytes?: number;       // default 10 * 1024 * 1024
  connectTimeoutMs?: number; // default 5_000
  totalTimeoutMs?: number;   // default 20_000
  acceptTypes?: string[];    // e.g. ["text/html","application/json"]
  purpose: "unfurl" | "image" | "integration" | "plugin";
  actor: ActorRef;           // for audit + rate limiting
}

export async function safeFetch(rawUrl: string, o: SafeFetchOpts): Promise<SafeResponse> {
  let url = parseUserUrl(rawUrl).unwrapOr(throwRejected);
  const deadline = Date.now() + (o.totalTimeoutMs ?? 20_000);
  let hops = 0;

  while (true) {
    if (Date.now() > deadline) throw new FetchRejected("timeout");
    // 1. resolve ALL addresses ourselves (no OS-cached surprise), both families
    const addrs = await dnsResolveAll(url.hostname, { timeoutMs: 2_000 });   // A + AAAA
    if (addrs.length === 0) throw new FetchRejected("dns_empty");
    // 2. EVERY resolved address must pass; one bad address rejects the host
    for (const a of addrs) if (isDenied(a, DENY_V4, DENY_V6)) throw new FetchRejected("private_address");
    // 3. pin: connect to a chosen validated IP, send Host + SNI = hostname (defeats rebinding,
    //    because the address we connect to is the one we validated, not a re-resolution)
    const pinned = pickFirst(addrs);
    const res = await httpRequestPinned({
      ip: pinned, host: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
      tls: url.protocol === "https:", servername: url.hostname,
      path: url.pathname + url.search, method: "GET",
      headers: {
        "user-agent": UA,                       // identifies NEXUS + a contact URL
        "accept": o.acceptTypes?.join(", ") ?? "*/*",
        "accept-encoding": "gzip, br",
        // never forward cookies, auth, or internal headers
      },
      connectTimeoutMs: o.connectTimeoutMs ?? 5_000,
      deadline,
      redirect: "manual",
    });

    if (isRedirect(res.status)) {
      if (++hops > (o.maxRedirects ?? 3)) throw new FetchRejected("too_many_redirects");
      const next = parseUserUrl(new URL(res.headers.location ?? "", url).toString());
      if (next.isErr()) throw new FetchRejected("redirect_rejected:" + next.error);
      url = next.value;                          // loop → full re-validation of the new host
      continue;
    }

    // 4. content controls
    const declared = Number(res.headers["content-length"] ?? 0);
    if (declared > (o.maxBytes ?? 10_485_760)) throw new FetchRejected("too_large");
    if (o.acceptTypes && !typeAllowed(res.headers["content-type"], o.acceptTypes))
      throw new FetchRejected("content_type");
    // 5. stream with a hard byte counter; abort the socket the moment the cap is exceeded
    const body = await readCapped(res.stream, o.maxBytes ?? 10_485_760, deadline);
    return { status: res.status, headers: res.headers, body, finalUrl: url.toString(), ip: pinned };
  }
}
```

Notes on the specific defenses:
- **Rebinding.** Because the socket connects to `pinned` (the validated IP) and only sets the `Host`
  header and TLS SNI to the hostname, a second DNS answer can never be used. Node's `lookup` option or
  a custom `Agent` implements this; `fetch()` with a plain hostname is **forbidden** in this codebase
  outside `safeFetch` (ESLint `no-restricted-globals` for `fetch` in `apps/api`, `apps/worker`,
  `packages/integrations`).
- **Redirects.** Manual, re-validated from scratch, capped at 3 hops, and the cumulative deadline
  carries across hops so a redirect chain cannot extend the timeout.
- **DNS pinning cache.** Resolutions are cached 30 s keyed by hostname *with the validated addresses*;
  the cache stores addresses, never a "safe" verdict for a hostname alone.
- **Timeouts.** connect 5 s, TLS handshake 5 s, first byte 10 s, total 20 s (unfurl) / 60 s
  (integration fetches, explicit opt-in).
- **Size.** 10 MB default; 2 MB for `image`; 25 MB for `integration` downloads. Enforced by counting
  bytes on the stream, not by trusting `content-length`.
- **Response handling.** The body is returned as bytes; parsing (HTML, JSON) happens in a separate
  step with its own limits (HTML parsed with a 5 MB / 10 s cap; only `<head>` metadata is read for
  unfurl, streaming-stop after `</head>`).
- **Rate limits.** Per-user 60 unfurls/min, per-host 10/min globally, per-project 600/h. Exceeding
  returns a typed rejection surfaced as "Too many link previews right now — try again in a minute."

### 5.2 Layer 2 — egress proxy

A dedicated service (`infra/egress-proxy`, Squid or a small Go CONNECT proxy — the reference impl is
Go so the CIDR policy is shared code with `safeFetch`) is the only route to the internet from
`worker`, `runner` and plugin egress. NetworkPolicy denies all other egress from those pods
(`19_DEPLOYMENT.md` §5).

Proxy behavior:
1. Requires proxy auth: each caller presents an identity token that maps to a policy
   (`worker-unfurl`, `runner:<integrationId>`, `plugin:<pluginId>`).
2. Re-resolves the target and applies the same CIDR denylist independently; a mismatch between what
   the caller expected and what the proxy resolves is logged as `ssrf.suspected` and blocked.
3. Enforces a **per-policy host allowlist** where one exists: e.g. `runner:github` may reach
   `api.github.com`, `github.com`, `codeload.github.com` and nothing else. `worker-unfurl` has no host
   allowlist (arbitrary public web is the feature) but has the CIDR denylist, a 10 MB cap and a
   request-rate cap.
4. Blocks non-80/443 ports, blocks `CONNECT` to anything but 443, strips hop-by-hop headers.
5. Emits an access log line per request (`ts, policy, method, host, ip, status, bytes, ms, verdict`)
   into the audit pipeline (`ssrf`/`egress` events).

### 5.3 Test corpus (N7 verification)

`packages/domain/test/ssrf.corpus.ts` must contain at least: `http://127.0.0.1`, `http://[::1]/`,
`http://0177.0.0.1`, `http://2130706433`, `http://0x7f.0.0.1`, `http://169.254.169.254/latest/meta-data/`,
`http://metadata.google.internal/`, `http://[::ffff:127.0.0.1]/`, `http://localtest.me` (public DNS →
127.0.0.1), a rebinding host served by a test DNS server alternating public/private, a 10-hop redirect
chain, a redirect from public → `http://10.0.0.5`, `file:///etc/passwd`, `gopher://…`,
`http://user:pass@evil/`, `http://evil:22/`, a 1 GB response, and a slowloris server sending 1 byte/s.
Every entry asserts a specific typed rejection, not merely "did not succeed".

---

## 6. File security

### 6.1 Upload pipeline

```text
client → presign (API, ACL-checked, 5 min, content-length range)
       → PUT to S3 under org/<orgId>/proj/<projectId>/incoming/<uuid>
       → client calls files.finalize(uploadId)
       → worker job "file-intake":
            1. stat size            (cap by type, §6.3)
            2. read first 64 KiB → magic-byte sniff (file-type lib + our own table)
            3. policy check: sniffed type ∈ allowlist AND matches declared extension class
            4. per-type deep validation (§6.4–§6.6)
            5. compute sha256 → move to org/<orgId>/proj/<projectId>/blob/<sha256> (content-addressed)
            6. generate derivatives (thumbnail, page images, text extraction) in an isolated worker
            7. write files row; emit file.uploaded audit event
       → node becomes available; until then the node shows a "Processing…" state
```

Nothing is served to any user before step 5 completes. The `incoming/` prefix has a 24 h lifecycle
rule and is never publicly presignable for download.

### 6.2 Magic-byte sniffing and mismatch policy

The declared MIME from the browser is **advisory only**. Decision table:

| Sniffed | Extension | Action |
|---|---|---|
| in allowlist, class matches extension | ok | accept, store canonical MIME from sniff |
| in allowlist, class differs (e.g. `.png` that is really PDF) | mismatch | accept **but** rename to the sniffed type's extension and flag `mimeMismatch` on the node; show a badge "file type corrected" |
| not in allowlist | any | reject 415 with the sniffed type named in the error |
| cannot be sniffed (unknown) and size < 1 MB and valid UTF-8 | `.txt`/`.md`/`.csv` | accept as `text/plain` |
| cannot be sniffed otherwise | any | reject 415 "unrecognized file type" |
| executable/script signatures (`MZ`, `ELF`, `#!`, Mach-O, `.class`, `.wasm`) | any | reject, audit `file.rejected.executable` |

Allowlist (v1): images `png jpeg webp gif avif`, documents `pdf docx xlsx pptx odt csv txt md json
html`, archives `zip` (only for board import), `eml`, `har`. SVG is **not** in the upload allowlist
(§6.5). Anything else is a phase-16 extension request with its own threat note.

### 6.3 Size and quota caps

| Class | Per-file cap | Notes |
|---|---|---|
| image | 25 MB | plus 50 MP pixel-count cap (decompression bomb) |
| document | 100 MB | PDF page cap 2,000 |
| archive (import) | 200 MB compressed | see §6.4 |
| text/json | 20 MB | |
| Project total | org-plan quota, default 25 GB | soft warning at 80%, hard block at 100% with a clear message |
| Per-user upload rate | 200 files / hour, 2 GB / hour | |

### 6.4 Archive bomb protection

Applies to board import archives and to any tool output archive:

```text
limits: maxEntries 5_000, maxTotalUncompressed 1 GiB, maxRatio 100:1 (per entry and overall),
        maxDepth 1 (no nested archives are expanded), maxPathLen 255
stream the archive; for each entry:
  reject if name is absolute, contains "..", a drive letter, a symlink or a hardlink entry
  reject if entry uncompressed size unknown AND running total would exceed the cap
  running_uncompressed += written bytes; abort the whole import the moment a cap trips
extraction target is a fresh temp dir with a size-limited tmpfs (1 GiB), removed in a finally block
```

Zip-slip, symlink escape, quines and nested bombs are all covered by the above; the extractor never
uses a shell tool, only a streaming library, and never preserves permissions.

### 6.5 Image parsing isolation and SVG

- All raster processing (thumbnails, EXIF strip, page rasterization) runs in the **media worker**, a
  separate process with `--max-old-space-size=512`, a 20 s per-image timeout, and the same container
  hardening as the runner (§7) minus network (network: none). A parser crash kills only that process;
  the job retries once, then the file is marked `preview_unavailable` and the original stays intact.
- Pixel bombs: `sharp`/`libvips` is configured with `limitInputPixels: 50_000_000`, and animated
  formats are capped at 200 frames.
- **SVG is never rendered as active content.** It is not accepted on upload; if an SVG arrives via a
  fetched page (og:image), the image proxy rasterizes it to PNG in the media worker and serves the
  PNG. A stored SVG (from an import) is served with `Content-Type: image/svg+xml`,
  `Content-Disposition: attachment`, from the storage origin, with
  `Content-Security-Policy: default-src 'none'; sandbox` — so it can only be downloaded, never framed.
- ICC/embedded-profile handling is disabled; color management is fixed to sRGB.

### 6.6 EXIF and metadata

Two paths, because OSINT users need metadata *as evidence* but must not leak it accidentally:

1. **Extraction (before stripping).** The intake job parses EXIF/XMP/IPTC and stores it as structured
   `file_metadata` (GPS, camera, timestamps, software) and offers it as an "Extract metadata" proposal
   that creates entity nodes (`14_AI_AGENT.md` §5.8 style proposal flow).
2. **Stripping (for derivatives and shares).** All generated derivatives (thumbnails, previews) are
   written with metadata stripped. Downloads of the **original** keep metadata by default because the
   original is evidence; when a board is shared by link or exported in "redacted mode" (§9.5),
   originals are re-encoded with metadata stripped and the export manifest records this.

### 6.7 Serving files

- Separate origin: `https://files.<app-domain>` (distinct host, no session cookie, its own CSP
  `default-src 'none'; sandbox`), served via short-lived presigned URLs.
- `Content-Disposition: attachment; filename*=UTF-8''<sanitized>` for everything except images and
  media used inline by the app, which use `inline` and are limited to sniff-verified image types.
- `X-Content-Type-Options: nosniff` always; the stored canonical MIME is used, never a client value.
- Filenames are sanitized to `[\w.\- ]{1,120}` for the header, with the original preserved in the DB
  for display (and escaped when displayed).
- Hotlink protection: presigned URLs are user-scoped and short-lived; the app never emits a permanent
  public URL except through an explicit share link (§9.4).

---

## 7. Tool sandbox

The runner executes third-party OSINT tools (Sherlock, SpiderFoot, future manifests). This is the
highest-risk component; N5 requires that no tool ever runs in the API process.

### 7.1 Baseline container flags (compose reference)

```bash
docker run \
  --rm \
  --user 65532:65532 \
  --read-only \
  --tmpfs /work:rw,noexec,nosuid,nodev,size=512m \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --security-opt seccomp=/etc/nexus/seccomp-tool.json \
  --security-opt apparmor=nexus-tool \
  --pids-limit 256 \
  --memory 1g --memory-swap 1g --cpus 1.0 \
  --ulimit nofile=512:512 --ulimit fsize=536870912 \
  --network nexus-egress \                       # only route: the egress proxy
  --env-file /run/secrets/<runId>.env \          # tmpfs-backed, 0400, deleted after start
  --stop-timeout 5 \
  --label nexus.run=<runId> \
  sherlock/sherlock@sha256:<pinned-digest> \
  <argv from the manifest, never containing secrets>
```

No `-v` host mounts, ever. Input files are copied into the tmpfs workdir through the container's
stdin/`docker cp` equivalent before start; outputs are read back from the tmpfs before teardown.

### 7.2 Kubernetes production profile

```yaml
apiVersion: batch/v1
kind: Job
spec:
  ttlSecondsAfterFinished: 300
  backoffLimit: 0
  template:
    spec:
      runtimeClassName: gvisor            # user-space kernel: the primary escape mitigation
      automountServiceAccountToken: false
      serviceAccountName: nexus-tool-runner   # zero RBAC verbs
      hostNetwork: false
      hostPID: false
      hostIPC: false
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        runAsGroup: 65532
        fsGroup: 65532
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: tool
          image: sherlock/sherlock@sha256:<digest>
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          resources:
            requests: { cpu: "250m", memory: "256Mi" }
            limits:   { cpu: "1",    memory: "1Gi", ephemeral-storage: "1Gi" }
          env:
            - { name: HTTPS_PROXY, value: "http://egress-proxy.nexus.svc:3128" }
            - { name: NO_PROXY,    value: "" }
          volumeMounts:
            - { name: work, mountPath: /work }
            - { name: secrets, mountPath: /run/secrets, readOnly: true }
      volumes:
        - name: work,    emptyDir: { medium: Memory, sizeLimit: 512Mi }
        - name: secrets, emptyDir: { medium: Memory, sizeLimit: 1Mi }
```

NetworkPolicy `runner-egress`: egress allowed **only** to the egress-proxy service on 3128 and to
kube-dns; all ingress denied. A separate NetworkPolicy on `api`/`postgres`/`redis` denies ingress from
the runner namespace. Verified by a CI test that runs a job attempting `psql`/`curl` to internal
services and asserts failure.

### 7.3 Seccomp / AppArmor

- Start from the container runtime's default seccomp (blocks ~44 syscalls incl. `mount`,
  `kexec_load`, `bpf`, `ptrace`, `userfaultfd`), then subtract further: `clone` with new namespace
  flags, `unshare`, `setns`, `pivot_root`, `perf_event_open`, `add_key`, `keyctl`, `io_uring_*`.
- AppArmor profile `nexus-tool`: deny `/proc/*/mem`, `/sys/**` write, `/dev` except `null zero random
  urandom tty`, deny `mount`, deny ptrace of other pids, allow read of the image rootfs and rw of
  `/work` + `/tmp` only.
- gVisor is the production requirement; the compose reference documents that without gVisor the
  isolation is "container-grade only" and self-hosters running untrusted third-party tool images
  should enable it (or a VM per run).

### 7.4 Manifest-level controls

Each integration manifest (`10_INTEGRATIONS.md` §3) declares and the runner enforces:

```ts
sandbox: {
  image: string;              // MUST be a digest reference; tags are rejected at manifest validation
  timeoutSec: number;         // ≤ 900, default 300
  memoryMb: number;           // ≤ 2048
  cpu: number;                // ≤ 2
  egress: { hosts: string[] } | { mode: "public-web" };  // mapped to a proxy policy
  outputs: { stdoutMaxBytes: number; filesMaxBytes: number; files: string[] };
  secrets: string[];          // credential ids, injected as files
}
```

Enforcement details:
- **Digest pinning.** `image` must match `^[\w./-]+@sha256:[a-f0-9]{64}$`. This is what makes the
  SpiderFoot maintenance risk (`12_SPIDERFOOT.md`) survivable: the exact bits we run are frozen and
  upgraded deliberately, with a changelog review, never by a moving tag.
- **Output caps.** stdout/stderr capped (default 8 MB each) with `output_truncated` flagged; produced
  files capped (default 64 MB total) and only the declared paths are collected. Exceeding a cap kills
  the run with `output_limit_exceeded` and keeps what was captured.
- **Timeout.** SIGTERM at `timeoutSec`, SIGKILL 5 s later, run marked `timeout`; partial output is
  parsed if the parser declares `partialOk`.
- **Concurrency.** Max 4 concurrent runs per project, 20 per org, global runner slot pool; queued runs
  show position in the run history UI.
- **Argv hygiene.** Arguments are built from a typed template with per-parameter validators (URL,
  username `^[A-Za-z0-9._-]{1,64}$`, etc.), passed as an argv array — never through a shell. No
  `sh -c` anywhere in the runner. Targets are additionally scope-checked (§9).

### 7.5 Secret injection

```text
1. API decrypts the credential (envelope, §8) only in the run-scheduling code path.
2. It writes it to a per-run in-memory volume file /run/secrets/<name> mode 0400 owned by 65532.
3. The manifest maps names → env vars via a wrapper: NEXUS_SECRET_FILE_GITHUB_TOKEN=/run/secrets/gh
   and the entrypoint shim exports the value only into the child's environment.
4. Never in argv (visible via /proc), never in the image, never in the job spec as a plain value
   (k8s: the value comes from a per-run Secret with ttl, deleted with the Job).
5. The runner scrubs secret values from stdout/stderr before storing output (exact-match replace with
   ⟦redacted:<name>⟧), so a tool echoing its token cannot persist it.
```

### 7.6 Runner isolation from the API network

- The runner service has **no** database credentials, no S3 credentials and no Redis credentials.
- It receives work by long-polling a narrow mTLS endpoint on the worker (`/runner/lease`), and posts
  results back to `/runner/result` with the run's one-time token. Payloads are size-capped and
  schema-validated on the worker side before anything touches storage.
- The worker, not the runner, writes to Postgres/S3. This means a fully compromised runner can at
  worst submit garbage results for runs it already holds a token for — which the parser and the
  import-proposal review (N4) then contain.

---

## 8. Secrets management

### 8.1 Classes

| Class | Examples | Storage |
|---|---|---|
| Platform secrets | `AUTH_SECRET`, DB URL, S3 keys, KMS key id | environment from the orchestrator's secret store (k8s Secret + sealed-secrets, or Docker secrets); never in the repo, never in an image |
| User/org integration credentials | GitHub PAT, SpiderFoot API key, AI provider key | Postgres `integration_credentials`, envelope-encrypted (§8.2) |
| Ephemeral | sync tickets, presign URLs, run tokens | Redis with TTL, never persisted |

### 8.2 Envelope encryption

```text
Root key (KEK): held by KMS (AWS KMS / GCP KMS / Vault transit). Self-host fallback: a 32-byte
                master key from the orchestrator secret store, with the same interface.
Per-record DEK: 32 random bytes, generated per credential.
Ciphertext:     AES-256-GCM(DEK, plaintext, nonce=12B random, aad = orgId|credentialId|version)
Stored:         { encDek (KEK-wrapped), nonce, ciphertext, tag, keyVersion, algo }
```

Schema:

```sql
CREATE TABLE integration_credentials (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,   -- null = org-wide
  integration_id text NOT NULL,
  label text NOT NULL,
  enc_dek bytea NOT NULL, nonce bytea NOT NULL, ciphertext bytea NOT NULL,
  key_version int NOT NULL,
  fingerprint text NOT NULL,        -- sha256(plaintext)[0..8], for "is this the same key?" UX
  last_four text,                   -- for display only
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz, rotated_at timestamptz, expires_at timestamptz
);
```

Rules:
- **Write-only API.** `credentials.create/update/delete` exist; there is no read endpoint returning
  plaintext. The UI shows label + `last_four` + fingerprint only.
- Decryption happens in exactly two code paths (`runner scheduling`, `worker direct API calls`), both
  in `apps/api/src/secrets/decrypt.ts`, and the plaintext is held in a `Buffer` that is zeroed after
  use and never placed in a JS string where possible.
- **Rotation:** KEK rotated annually or on incident → background re-wrap job (`rewrap-deks`) updates
  `enc_dek` and `key_version` without touching ciphertext. DEK/credential rotation is user-driven,
  with `rotated_at` shown and a reminder at 180 days. Compromise procedure: revoke at the provider,
  delete the credential, re-issue; the audit log lists every run that used it.
- **Never logged.** A logger serializer redacts keys matching
  `/(token|secret|password|api[_-]?key|authorization|cookie|set-cookie|dek)/i` and any value matching
  known prefixes (`ghp_`, `github_pat_`, `sk-`, `AKIA`, JWT shape). A CI test feeds a fixture object
  containing each pattern through the logger and asserts none appears in the output.
- Error messages, Sentry payloads and audit `metadata` go through the same redactor; request bodies
  are never attached to error reports for auth or credential routes.

---

## 9. Headers, CSP, supply chain

### 9.1 Response headers (all app responses)

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
X-Frame-Options: DENY            (plus frame-ancestors 'none' in CSP)
Cache-Control: no-store          (on every authenticated JSON response)
```

Static assets are immutable + hashed (`Cache-Control: public, max-age=31536000, immutable`).
The API sets `Vary: Origin, Cookie` where relevant.

### 9.2 Subresource integrity and third-party code

- **No third-party scripts on the app origin.** No analytics tag, no font CDN, no widget. Fonts,
  icons and all JS are self-hosted and bundled; this is what allows a CSP without `unsafe-inline`
  for scripts.
- Any future externally hosted script must carry `integrity` + `crossorigin="anonymous"` and be added
  to CSP explicitly; the build fails if an external `<script src>` lacks SRI (`scripts/check-sri.ts`).
- The Vite build emits a manifest of asset hashes used by the SRI checker and by release verification.

### 9.3 Dependency and supply-chain policy

| Control | Rule |
|---|---|
| Lockfile | committed; CI installs with `--frozen-lockfile`; a PR changing the lockfile without a package.json change fails |
| Audit | `npm audit --omit=dev` must be clean of **high/critical** (gate item 5 of `00_MASTER.md` §8); moderate issues require a dated exception entry in `SECURITY-EXCEPTIONS.md` with an owner |
| New dependency | requires: purpose, alternatives considered, maintenance signal (last release, open issues), transitive count, license check (allowlist: MIT, Apache-2.0, BSD-2/3, ISC, MPL-2.0; copyleft server-side deps require approval) |
| Provenance | prefer packages publishing npm provenance; `npm ci --ignore-scripts` in CI, with an explicit allowlist of packages permitted to run install scripts |
| Container images | referenced **by digest** everywhere (base images, tool images); Renovate opens digest-bump PRs; `docker scout`/`trivy` scan in CI blocks HIGH+ in our own images |
| SBOM | CycloneDX SBOM generated per release for every image and the web bundle (`syft`), attached to the GitHub release, and diffed against the previous release in the PR |
| Signing | release images signed with cosign (keyless OIDC); the deploy step verifies the signature before rollout |
| Secrets scanning | gitleaks in pre-commit and CI on the full history of the PR branch |
| CI hardening | least-privilege `GITHUB_TOKEN` permissions per job, no `pull_request_target` with checkout of untrusted code, actions pinned by commit SHA |

---

## 10. Audit log

### 10.1 Event schema

```ts
export interface AuditEvent {
  id: string;              // uuidv7 (time-ordered)
  ts: string;              // server time, ISO, authoritative
  orgId: string;
  projectId: string | null;
  boardId: string | null;
  actor: {
    kind: "user" | "api_key" | "system" | "share_link";
    id: string;
    label: string;         // denormalized display name at event time
    ip: string | null;     // /24 or /64 truncated
    userAgent: string | null;
    sessionId: string | null;
  };
  action: string;          // dotted verb, closed enum, e.g. "node.delete"
  target: { type: string; id: string; label?: string } | null;
  result: "success" | "denied" | "error";
  reason?: string;         // for denied/error, from the typed error taxonomy
  metadata: Record<string, unknown>;  // redacted, ≤ 4 KB
  beforeHash?: string;     // sha256 of the previous value (mutations)
  afterHash?: string;
  prevChainHash: string;   // tamper-evidence chain, §10.4
  chainHash: string;
}
```

```sql
CREATE TABLE audit_events (
  id uuid PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(),
  org_id uuid NOT NULL, project_id uuid, board_id uuid,
  actor jsonb NOT NULL, action text NOT NULL, target jsonb,
  result text NOT NULL, reason text, metadata jsonb NOT NULL DEFAULT '{}',
  before_hash text, after_hash text, prev_chain_hash text NOT NULL, chain_hash text NOT NULL
);
CREATE INDEX audit_org_ts   ON audit_events (org_id, ts DESC);
CREATE INDEX audit_proj_ts  ON audit_events (project_id, ts DESC);
CREATE INDEX audit_action   ON audit_events (action, ts DESC);
REVOKE UPDATE, DELETE ON audit_events FROM nexus_app;   -- append-only for the app role
```

### 10.2 What is logged (non-exhaustive but mandatory)

`auth.login`, `auth.login_failed`, `auth.logout`, `auth.2fa_enabled/disabled/failed`,
`auth.password_changed`, `auth.email_changed`, `session.revoked`, `apikey.created/revoked`,
`org.member_invited/joined/removed`, `role.changed` (before/after role),
`project.created/renamed/deleted/restored`, `board.created/deleted/duplicated`,
`node.bulk_delete` (count + ids hash; individual node edits are **not** audited — the Yjs history and
snapshots cover them; auditing every keystroke-level CRDT op is neither useful nor affordable),
`file.uploaded/rejected/downloaded/deleted`,
`integration.credential_created/rotated/deleted`, `integration.run_started/finished/failed`
(tool, image digest, target, duration, exit code, output bytes, egress hosts contacted),
`proposal.applied` (proposal id, item count, accepted ids),
`ai.run` (capability, model, tokens, cost, flags — see `14_AI_AGENT.md` §9),
`export.created` (scope, format, file count, size), `share.created/updated/revoked/accessed`
(accessed logs the link id, truncated IP, and referrer host only),
`permission.changed`, `scope.updated`, `consent.recorded`,
`security.ssrf_blocked`, `security.egress_blocked`, `security.rate_limited`,
`security.csp_report` (sampled), `admin.impersonation_started/ended` (self-host operator feature,
requires a written reason and notifies the affected user).

### 10.3 Retention

- Security/auth/permission/integration/export/share events: **13 months** (covers an annual review
  cycle) or the org's configured value (90 days minimum, 7 years maximum).
- High-volume operational events (`security.rate_limited`, `csp_report`): 30 days.
- Deleting a project soft-deletes its events with the project and hard-deletes them at the end of the
  grace period, **except** security events, which are retained at org scope with the project id
  preserved (accountability survives deletion of the workspace being audited).
- Partitioned monthly (`audit_events_YYYY_MM`) with a detach-and-archive job writing Parquet to
  cold storage.

### 10.4 Tamper evidence

```text
chainHash_n = sha256( chainHash_(n-1) || canonicalJson(event_n without chainHash) )
```

- One chain per `org_id`; the head is stored in `audit_chain_heads (org_id, last_id, chain_hash,
  updated_at)` and updated in the same transaction as the insert (serialized per org by an advisory
  lock, which is affordable given audit volume).
- A daily job re-verifies the last 24 h of chain links and, once per day, publishes the head hash to
  an append-only external sink (S3 object-lock bucket, or a log-only file with restricted ACL) so an
  operator who edits the DB cannot silently rewrite history.
- Verification endpoint (org owner only) reports: verified range, first mismatch id if any.
- The app role has no UPDATE/DELETE grant; only a migration-role can alter the table, and migrations
  touching `audit_events` require an explicit review label on the PR.

### 10.5 User-visible activity view

Route `/projects/:id/activity`. Timeline grouped by day, filters (actor, action category, date range,
result), search over target labels, CSV export (project_admin+). Rows use plain-language copy:
"Anna revoked the share link for *Board: Targets* — 12 Aug, 14:03 · 203.0.113.0/24".
Viewers see only their own events (matrix §3.2). Every row links to the affected resource where it
still exists; deleted resources render as a tombstone chip. Empty state: "No activity in this range."
Security-relevant events (permission changes, share links, exports, integration runs) are visually
marked with a subdued accent, no alarm colors unless `result = "denied"`.

---

## 11. Data protection

### 11.1 In transit

TLS 1.2+ (prefer 1.3) everywhere externally; HSTS with preload; internal service-to-service traffic in
Kubernetes uses mTLS (mesh or explicit certs) at minimum between worker↔runner and app↔proxy.
Postgres and Redis connections require TLS (`sslmode=verify-full`) with a pinned CA in production.
WebSocket is `wss://` only; plain `ws://` is refused by the client.

### 11.2 At rest

| Store | Mechanism |
|---|---|
| Postgres | volume-level encryption (cloud KMS or LUKS self-host) + column-level envelope encryption for credentials and 2FA secrets |
| S3/MinIO | SSE-KMS (cloud) or SSE-S3/at-rest disk encryption (self-host); bucket public access blocked; versioning on; object-lock on the audit archive bucket |
| Redis | no durable secrets; AOF disabled for the queue instance or the volume encrypted; TLS in transit |
| Backups | §11.3 |
| Client | IndexedDB/OPFS are **not** encrypted (browser-level protection only); the app states this in Settings → Security and offers "Clear local data on sign-out" (default on for shared-device mode) |

### 11.3 Backups

- Nightly full + WAL continuous archiving for Postgres; S3 bucket replication or nightly sync for
  objects; both encrypted with a **separate** KMS key from production data, so a production key
  compromise does not automatically unlock backups.
- Backup access is restricted to a break-glass role; every restore is an audited operation.
- Retention 35 days (daily) + 12 monthly; deleted-user data therefore persists in backups up to the
  retention window — this is disclosed in the deletion UI ("removed from backups within 35 days").
- Restore drill quarterly with a recorded RTO/RPO (target RPO ≤ 5 min, RTO ≤ 2 h), see
  `19_DEPLOYMENT.md` §8.

### 11.4 Deletion and export rights

- **Export** (self-service): a user can export their org's projects as a ZIP containing the board JSON
  v1 (N9), all original files, `audit.csv`, `ai-activity.csv`, `integration-runs.csv`, and a
  `manifest.json` with per-file sha256 and the export's own hash. Rate-limited to 3 exports/day/org
  and audited. Large exports are produced by a job and delivered as a 24 h presigned link, then deleted.
- **Deletion:** project delete → soft delete (restorable 30 days, visible in a Trash view) → hard
  delete job removing rows, Yjs snapshots, S3 objects (content-addressed blobs are refcounted and only
  removed when the last reference goes), embeddings, and the AI context payloads. Account deletion
  cascades org deletion only if the user is the sole owner; otherwise ownership transfer is required.
- A deletion receipt (what was deleted, when, by whom, remaining backup window) is written to the
  audit log and emailed.

### 11.5 Share links

```ts
interface ShareLink {
  id: string;                 // public, 12 chars base58 (≈70 bits with the secret below)
  secret: string;             // 32 random bytes, carried in the URL fragment, stored only as sha256
  boardId: string;
  scope: "board" | "board_with_files";
  permissions: { comment: boolean; export: boolean; showActivity: false };
  password?: { hash: string };          // argon2id, optional
  expiresAt: string | null;             // default 30 days, max 365, "never" requires project_admin
  maxViews?: number;
  revokedAt: string | null;
  createdBy: string;
}
```

- URL form: `https://app/.../s/<id>#<secret>` — the secret lives in the **fragment**, so it is never
  sent in the Referer header or logged by the server; the client posts it to
  `share.resolve({id, secret})` and receives a short-lived read-only session (15 min, renewable while
  the tab is open) scoped to that board.
- Stored as `sha256(secret)`; a lookup is constant-time and rate-limited (10 attempts/min/IP/link).
- Shared boards are served through the same authz function with a synthetic `share_link` actor, so a
  shared viewer cannot reach files, comments, activity or other boards unless the scope grants it.
- `noindex, nofollow` headers + `robots.txt` deny on share routes.
- Every access is audited (§10.2) and the owner sees a live "12 views, last 3 min ago" panel with
  one-click revoke. Revocation is immediate (no cached grant).
- Redaction mode (§11.6) can be enforced on a link: the recipient sees redacted content only.

### 11.6 Redaction mode

A project-level or share-level mode that renders and exports content with configured classes masked:
emails, phones, faces (opt-in blur via the media worker), custom regex rules, and any node tagged
`sensitive`. Implementation: redaction is applied **server-side** when producing the shared payload or
export (never client-side hiding of data that was still transmitted). Masked values are replaced by
`⟦redacted⟧` chips; the count of redactions is shown so the reader knows content was removed. Node
positions and structure remain visible so the graph is still comprehensible.

---

## 12. Acceptable use enforcement

The product is for authorized research (`00_MASTER.md` §3.6). Enforcement is technical, not just
textual.

### 12.1 Project scope and consent records

```sql
CREATE TABLE project_scopes (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('domain','ip_cidr','username','email','repo','org_name','other')),
  value text NOT NULL,
  authorization_basis text NOT NULL CHECK (authorization_basis IN
    ('own_asset','written_permission','public_data','legal_process','other')),
  evidence_file_id uuid REFERENCES files(id),      -- e.g. the signed engagement letter
  note text,
  valid_from date NOT NULL DEFAULT now(),
  valid_to date,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_scope_uniq ON project_scopes (project_id, kind, lower(value));
```

- Creating a project asks for at least one scope entry or an explicit choice of
  "public-data research (no active tooling)", which disables every active-probing integration.
- Running an **active** integration (SpiderFoot scans, anything that touches the target's
  infrastructure) requires the target to match a scope entry that is currently valid; otherwise the
  run is refused with: *"Target `x` is not in this project's authorized scope. Add it with an
  authorization basis, or choose a passive tool."* Passive tools (Sherlock's public-profile checks,
  GitHub public API, unfurl) run against any public target but still record the target in the run log.
- Scope evaluation is a pure function `inScope(target, scopes)` with explicit matchers per kind
  (domain: eTLD+1 or subdomain-of; ip: CIDR containment; username: exact, case-insensitive), tested
  and shared by the API, the runner scheduler and `14_AI_AGENT.md` §5.13.
- Scope changes are audited (`scope.updated`) and shown in the report export appendix, which is what
  makes an investigation defensible.

### 12.2 Abuse rate limits

| Limit | Value | Scope |
|---|---|---|
| Active tool runs | 20/h, 100/day | project |
| Active tool runs | 200/day | org |
| Distinct targets per active run | 1 (batch runs enumerate sequentially with the same caps) | run |
| Unfurl | 60/min user, 10/min per remote host | global |
| Exports | 3/day | org |
| Share link creation | 20/day | project |
| Auth attempts | 10/15 min per account, 100/15 min per IP | global |
| API v1 | 600 req/min per key, burst 60 | key |

Exceeding a limit returns a typed error with the retry time and is audited. Sustained abuse
(3 limit breaches in 24 h on active tooling) flags the org for review in the admin console and
notifies the org owner.

### 12.3 What the product refuses to do

Hard refusals, implemented as absent features (not as prompts or warnings):

1. No exploitation, brute-forcing or credential-stuffing tooling; manifests declaring such capability
   are rejected by manifest validation (`capabilities` allowlist in `10_INTEGRATIONS.md`).
2. No mass unsolicited contact, scraping-for-marketing, or bulk personal-data harvesting workflows
   (no "export all emails found" bulk action; entity export is per-board and audited).
3. No deanonymization aids: no facial recognition, no gait/voice matching, no purchase of leaked
   credential databases, no built-in breach-data lookup.
4. No stalking affordances: no "monitor this person continuously" scheduler for person-type targets
   (scheduled monitoring exists only for domains/repos/own assets).
5. No hidden or covert operation: the user agent identifies NEXUS with a contact URL, `robots.txt` and
   crawl-delay are honored by the unfurl fetcher, and there is no proxy-rotation or CAPTCHA-solving
   feature.
6. No execution of arbitrary user-supplied code: only digest-pinned, manifest-declared tool images
   installed by an org admin.
7. No silent data collection about the app's own users beyond what §10 documents; telemetry is
   opt-in, aggregate, and never includes graph content.

These are stated in-product (Settings → Acceptable use) with the same wording, so the boundary is
discoverable rather than surprising.

### 12.4 Reporting and takedown

A self-host operator gets `SECURITY.md` and an admin console page listing orgs flagged by §12.2, with
actions: warn, suspend active tooling, suspend org. Every action requires a reason, notifies the org
owner, and is audited. For the hosted offering, an abuse contact address and a 72 h triage SLA are
documented in `19_DEPLOYMENT.md`.

---

## 13. Security verification per phase

| Phase | Mandatory security evidence |
|---|---|
| P1 | Better-Auth config review, cookie flags asserted in e2e, headers snapshot test, env schema |
| P2–P5 | no new external inputs; sanitizer tests for rich text (P4) |
| P6 | full SSRF corpus green (N7), file intake tests, archive bomb tests, preview iframe test |
| P7 | RLS tests, cross-tenant e2e suite, search injection tests |
| P8 | sync ticket tests, readOnly enforcement, awareness payload filtering |
| P9 | sandbox escape suite, NetworkPolicy test, secret-not-in-argv test, output cap test |
| P10–P12 | per-integration egress allowlist test, digest pinning check, parser fuzzing |
| P13 | AI guardrail suite (`14_AI_AGENT.md` §10 items 3, 4, 6) |
| P15 | export manifest hashes, share-link e2e (expiry, revoke, password, redaction) |
| P16 | full audit: dependency review, SBOM diff, chain verification, pen-test checklist, threat model re-read |

A phase cannot pass the gate (`00_MASTER.md` §8 item 5) without its row above.

---

## Open risks

1. **gVisor is not universal.** Self-hosters on unsupported kernels or nested virtualization will run
   container-grade isolation only. Mitigation: the installer detects and warns, the manifest UI marks
   tools as "runs with reduced isolation", and the docs recommend a dedicated VM for the runner.
2. **SpiderFoot maintenance risk** (verified: 0 commits/issue activity in the last 90 days as of the
   June 2026 deps.dev snapshot). Mitigation: digest pinning, adapter isolation, a documented fallback
   to targeted per-module runs and to Sherlock/GitHub-only workflows; an unpatched CVE in that image
   is contained by §7 but not eliminated. Review quarterly; if a CVE with in-sandbox impact appears
   and no fix lands within 30 days, disable the integration by default.
3. **Unfurl is an open egress by design.** `worker-unfurl` has no host allowlist; the CIDR denylist and
   the proxy are the only barriers. A future internal service reachable from a public IP inside the
   operator's network would not be caught by CIDR rules. Mitigation: operators can add custom denylist
   entries (`EGRESS_EXTRA_DENY_CIDRS`) and the docs require it for split-horizon networks.
4. **Third-party parser CVEs** (PDF, DOCX, image libraries) remain the most likely RCE path.
   Mitigation: media worker isolation, timeouts, memory caps, digest-pinned base images, weekly
   dependency bumps; residual risk accepted for phase 1–15, re-reviewed at P16.
5. **Client-side local data is unencrypted** (IndexedDB/OPFS). A compromised or shared device exposes
   cached boards. Mitigation: disclosed in Settings, "clear on sign-out" option, and no credentials or
   tokens are ever stored client-side beyond the HttpOnly cookie.
6. **Audit chain protects against post-hoc edits, not against a compromised app at write time.** An
   attacker with code execution in the API can write false events. Mitigation: external head
   publication, restricted DB grants, and infrastructure-level logging outside the app's reach.
7. **Scope enforcement depends on honest scope entries.** NEXUS cannot verify that a written
   permission is genuine. Mitigation: evidence file attachment, immutable audit of scope changes, and
   the report appendix that exposes the claimed basis to any reviewer.
8. **Share links are bearer credentials.** Anyone with the URL has the granted access until expiry.
   Mitigation: fragment-carried secret, default 30-day expiry, optional password, view counters,
   instant revocation, and per-access audit.
