# NEXUS — 13 — SHERLOCK INTEGRATION (username enumeration)

## Scope

Specifies the Sherlock integration: verified upstream facts, the exact sandboxed container
execution contract, defensive parsing of the JSON artifact behind a version probe, the semantics of
"claimed / available / error" per site and how confidence is derived, the graph mapping from a
`username` node to `profile` nodes and derived domain/website nodes, re-run diffing that feeds the
watchlist, and the ethics/consent gating.
Ships in phase **P11** (`00_MASTER.md` §7). Execution is in the runner sandbox (N5); every node
arrives through a Proposal (N4).

---

## 1. Verified upstream facts

As of 2026-08-17, from live sources:

| Fact                     | Value                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Repository               | `sherlock-project/sherlock`                                                           |
| License                  | MIT                                                                                   |
| Latest release           | **v0.16.0**, published **2025-09-16**                                                 |
| Implementation           | Python CLI                                                                            |
| Coverage                 | ~400+ sites                                                                           |
| Relevant flags           | `--json FILE`, `--site`, `--timeout`, `--print-found`, `--nsfw`, `--local`, `--proxy` |
| Official container image | `sherlock/sherlock`                                                                   |
| Maintenance              | actively maintained                                                                   |

Applying `11_GITHUB.md` §5.8: recent release + active maintenance → band `healthy`. This is why
Sherlock is also the **tier-2 fallback** for SpiderFoot's username family
(`12_SPIDERFOOT.md` §1.2).

Nothing beyond this table is treated as known. In particular, the **exact JSON document shape of
`--json` is not assumed**; §4 specifies a schema-tolerant parser plus a version probe, and §4.5
specifies what happens when the shape is unrecognizable.

---

## 2. Integration manifest

The canonical manifest schema is `zIntegrationManifest` in `10_INTEGRATIONS.md` §4.1 and it wins on
every field name. The snippet below is an **abbreviated projection** of the Sherlock manifest
showing only the fields this document reasons about; the real file parses through
`zIntegrationManifest` (so it additionally carries `manifestVersion`, `toolVersion: '0.16.0'`,
`publisher`, `capabilities: ['enumerate-usernames']`, `parser`, `rateLimits`, `costHints`,
`maturity: 'stable'`, `risk.upstreamMaintenance: 'active'` and the `consent.scopeText` of §7.2).

```ts
// packages/integrations/sherlock/manifest.ts
export const sherlockManifest: IntegrationManifest = {
  id: 'sherlock',
  name: 'Sherlock',
  version: '1.0.0',
  upstream: {
    repository: 'https://github.com/sherlock-project/sherlock',
    license: 'MIT',
    pinnedRelease: 'v0.16.0',
  },
  category: 'identity',
  execution: {
    kind: 'container',
    image: 'sherlock/sherlock',
    imageDigest: process.env.SHERLOCK_IMAGE_DIGEST ?? null, // required in production
    network: 'allowlist',
    timeoutMs: 600_000,
    resources: { memoryMb: 1024, cpus: 1, pidsLimit: 256, tmpfsMb: 256 },
  },
  inputs: [
    {
      name: 'username',
      type: 'username',
      required: true,
      pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
    },
    { name: 'sites', type: 'string[]', required: false },
    { name: 'timeoutSec', type: 'number', required: false, default: 15, min: 3, max: 60 },
    { name: 'nsfw', type: 'boolean', required: false, default: false },
    { name: 'proxy', type: 'string', required: false },
  ],
  outputs: { format: 'json', path: '/out/{username}.json' },
  permissions: ['net:allowlist', 'fs:/out'],
  consent: 'per-run',
  proposesNodeKinds: ['profile', 'username', 'domain', 'link'],
  proposesEdgeKinds: ['has_profile', 'hosted_on', 'links_to', 'same_handle_as'],
};
```

Deleting `packages/integrations/sherlock/` must leave the build green and previously imported nodes
intact (same architecture test as `12_SPIDERFOOT.md` §9.6).

---

## 3. Execution specification

### 3.1 Command template

```
docker run --rm \
  --name nexus-sherlock-{runId} \
  --user 65532:65532 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 256 \
  --memory 1g --memory-swap 1g --cpus 1 \
  --network nexus-egress \
  --env HTTP_PROXY=http://egress:3128 \
  --env HTTPS_PROXY=http://egress:3128 \
  --env NO_PROXY= \
  --mount type=bind,src=/var/nexus/runs/{runId}/out,dst=/out,rw \
  {image}@{digest} \
  {argv}
```

`argv` construction (order fixed, values shell-escaped by array form — never string interpolation
into a shell):

```ts
function buildArgv(input: SherlockInput, caps: SherlockCapabilities): string[] {
  const a: string[] = [];
  a.push(input.username); // positional, validated by pattern
  a.push('--json', `/out/${safeFile(input.username)}.json`);
  a.push('--timeout', String(input.timeoutSec ?? 15));
  if (input.sites?.length) for (const s of input.sites.slice(0, 40)) a.push('--site', s);
  if (input.nsfw && caps.flags.has('--nsfw')) a.push('--nsfw');
  if (caps.flags.has('--print-found')) a.push('--print-found'); // stdout readability only
  if (input.proxy && caps.flags.has('--proxy')) a.push('--proxy', input.proxy);
  if (caps.flags.has('--local')) a.push('--local'); // use the image's bundled site list
  return a;
}
```

Notes on flag choices:

- `--json FILE` is the machine-readable contract; stdout is captured but never parsed for results.
- `--local` uses the site list shipped in the image instead of fetching a remote list, which keeps
  the run deterministic and removes one network dependency. If the probe does not report `--local`,
  the run proceeds without it and the remote list host must be in the egress allowlist (§3.3).
- `--print-found` only affects stdout; it makes the live log readable in the run drawer.
- `--nsfw` is off by default and is a per-run user choice, surfaced with a plain explanation.
- Multiple usernames per invocation are **not** used: one username per run keeps provenance,
  cancellation and quota accounting one-to-one with a run record.

Kubernetes equivalent: `runtimeClassName: gvisor`, `readOnlyRootFilesystem: true`,
`runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`,
`seccompProfile: RuntimeDefault`, emptyDir `medium: Memory` for `/tmp`, and an emptyDir for `/out`
copied out by the runner sidecar (`19_DEPLOYMENT.md` §5).

### 3.2 Resource limits and timeouts

| Limit                    | Value                           | Enforcement                                          |
| ------------------------ | ------------------------------- | ---------------------------------------------------- |
| Wall clock               | 600 s default, max 1800 s       | runner: SIGTERM at limit, SIGKILL at +10 s           |
| Per-site timeout         | `--timeout` 15 s default (3–60) | tool flag                                            |
| Memory                   | 1 GiB                           | cgroup, OOM → `SH_OOM`                               |
| CPU                      | 1 core                          | cgroup                                               |
| PIDs                     | 256                             | cgroup                                               |
| Output artifact          | 32 MB                           | runner refuses to read beyond; `SH_OUTPUT_TOO_LARGE` |
| stdout/stderr capture    | 2 MB each, head+tail truncation | runner                                               |
| Concurrent Sherlock runs | 2 per user, 8 per instance      | BullMQ concurrency + rate limiter                    |
| Runs per user            | 20 / hour, 100 / day            | Redis counter, `SH_QUOTA`                            |

### 3.3 Proxy and egress policy

- No direct network. All traffic exits through the egress proxy.
- **Allowlist policy for Sherlock is broad by necessity** — it must reach ~400 third-party sites.
  Rather than enumerating them, the policy is:
  - allow: TCP 443/80 to any **public** IP,
  - deny: all RFC1918, loopback, link-local, IPv6 ULA, and cloud metadata endpoints
    (`169.254.169.254`, `metadata.google.internal`) — enforced at the proxy by resolved IP, after
    DNS, so DNS rebinding cannot bypass it,
  - deny: any host in the instance's own domain and the NEXUS service hostnames,
  - cap: `EGRESS_MAX_REQUESTS = 3_000`, `EGRESS_MAX_BYTES = 128 MB` per run,
  - rate: max 10 requests/second aggregate per run.
- User-supplied `--proxy` is validated by the SSRF guard (N7): must be `http(s)://` or `socks5://`,
  public host, and it is used **in addition to** our egress proxy (the container's proxy env still
  points at ours; the tool-level proxy value is passed through and the egress proxy CONNECTs to it).
  A user-supplied proxy pointing at a private address is rejected with `SH_PROXY_INVALID`.
- The run report lists: requests made, bytes, blocked destinations, and the number of sites that
  timed out.

### 3.4 Artifact handling

1. Runner creates `/var/nexus/runs/{runId}/out` owned by `65532:65532`, mode `0700`.
2. After exit, the runner:
   - checks the exit code (§3.5),
   - stats the JSON file: missing → `SH_NO_OUTPUT`; > 32 MB → `SH_OUTPUT_TOO_LARGE`,
   - computes sha256, uploads to `s3://nexus/runs/{runId}/sherlock.json` with 30-day lifecycle,
   - uploads `stdout.log`, `stderr.log`, and a `run.json` (argv, image digest, capabilities,
     timings, egress stats),
   - deletes the host directory.
3. The parser reads from S3 with a streaming JSON parser; the raw artifact remains downloadable
   from the run drawer ("Download raw result") — the roadmap's requirement that the analyst can see
   raw _and_ parsed results.

### 3.5 Exit code handling

The exact exit-code semantics of the CLI are **not** part of our verified facts, so the runner does
not branch on specific non-zero values:

```
exit 0  + JSON present            -> success
exit !=0 + JSON present + parses  -> success with warning SH_NONZERO_EXIT (stderr shown)
exit !=0 + no JSON                -> SH_TOOL_FAILED (stderr tail in the error body)
killed by timeout + JSON present  -> partial success, results labeled "partial (timed out)"
killed by timeout + no JSON       -> SH_TIMEOUT
OOM kill                          -> SH_OOM
```

This "trust the artifact, not the exit code" rule is deliberate: a tool that checks 400 sites will
routinely have partial failures, and discarding a complete result set because of a non-zero exit
would be worse than surfacing a warning.

### 3.6 Version / capability probe

Before the first run per image digest (and cached forever per digest):

```
docker run --rm --network none {image}@{digest} --version   -> stdout
docker run --rm --network none {image}@{digest} --help      -> stdout
```

```ts
export interface SherlockCapabilities {
  imageDigest: string;
  probedAt: string;
  versionString: string | null; // raw line
  semver: string | null; // parsed x.y.z if present
  flags: Set<string>; // parsed from --help: every /^\s+(-{1,2}[\w-]+)/ token
  supportsJsonFlag: boolean; // '--json' in flags  (required)
  jsonShape: 'unknown' | 'map-of-sites' | 'map-of-usernames' | 'array-of-records';
}
```

Rules:

- `supportsJsonFlag === false` → the integration is marked unavailable with
  `SH_INCOMPATIBLE_IMAGE` and the operator is told which digest failed. We never fall back to
  parsing human-readable stdout as a result source.
- `semver === null` is **not** fatal; the parser is shape-driven, not version-driven. The version is
  recorded in provenance so a future shape change is diagnosable.
- If the probed semver is lower than `0.16.0`, a warning banner appears in Settings: "This image
  predates the version NEXUS was verified against (v0.16.0). Results may parse differently."
- `jsonShape` is set to `unknown` at probe time and learned from the first successful run (§4.2),
  then cached per digest.

---

## 4. Defensive parsing

### 4.1 Design rule

The parser is a **shape detector followed by a normalizer**, and it must never throw. Its output is
always a `SherlockResult` with counts of what it could and could not read.

```ts
export interface SherlockSiteResult {
  site: string; // service name as reported
  url: string | null; // profile URL as reported (validated)
  urlMain: string | null; // service root, as reported or derived
  status: 'claimed' | 'available' | 'unknown' | 'error' | 'illegal';
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  raw: unknown;
}

export interface SherlockResult {
  username: string;
  imageDigest: string;
  toolVersion: string | null;
  shape: SherlockCapabilities['jsonShape'];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sites: SherlockSiteResult[];
  counts: {
    total: number;
    claimed: number;
    available: number;
    error: number;
    unknown: number;
    unreadable: number;
  };
  partial: boolean; // true when the run was cut short
  warnings: string[];
}
```

### 4.2 Shape detection

```
parse(json):
  if Array.isArray(json):
      shape = 'array-of-records'
      records = json
  else if isObject(json):
      keys = Object.keys(json)
      // Case A: { "siteName": { ... }, ... }
      // Case B: { "username": { "siteName": { ... } }, ... }
      sampleValue = json[keys[0]]
      if isObject(sampleValue) && looksLikeSiteRecord(sampleValue):
          shape = 'map-of-sites';       records = entries(json).map(([site, v]) => ({site, ...v}))
      else if isObject(sampleValue) && every value of sampleValue looksLikeSiteRecord:
          shape = 'map-of-usernames';   records = flatten(entries(json))
      else: shape = 'unknown'
  else: shape = 'unknown'

looksLikeSiteRecord(v) =
  hasAnyKey(v, ['status','exists','url_user','url','http_status','response_time_s','error'])
```

Detected shape is written back to `SherlockCapabilities.jsonShape` for that image digest, so
subsequent runs skip detection (but still validate: a mismatch re-runs detection and logs a
warning).

### 4.3 Field normalization

```ts
const STATUS_MAP: Record<string, SherlockSiteResult['status']> = {
  claimed: 'claimed',
  found: 'claimed',
  exists: 'claimed',
  true: 'claimed',
  available: 'available',
  not_found: 'available',
  notfound: 'available',
  false: 'available',
  error: 'error',
  unknown: 'unknown',
  illegal: 'illegal',
  blocked: 'error',
  waf: 'error',
};

function readStatus(rec: Record<string, unknown>): SherlockSiteResult['status'] {
  const raw = pickAny(rec, ['status', 'exists', 'result', 'state']);
  if (raw === null || raw === undefined) return 'unknown';
  const key = String(typeof raw === 'object' ? ((raw as any).status ?? '') : raw)
    .toLowerCase()
    .trim();
  return STATUS_MAP[key] ?? 'unknown'; // never throw, never guess a positive
}
```

Other fields:

- `url` ← first of `url_user`, `url`, `profile_url`; validated as absolute `http(s)` with a public
  host; anything else becomes `null` plus a warning. This is the SSRF boundary for tool output
  (N7): tool-produced URLs are untrusted input.
- `urlMain` ← `url_main` if present, else the origin of `url`.
- `httpStatus` ← numeric coercion of `http_status`/`status_code`, else `null`.
- `responseTimeMs` ← `response_time_s * 1000` when numeric, else `response_time_ms`, else `null`.
- `site` ← the record key, or `site`/`name` field; trimmed, max 64 chars.

**Bias rule:** any ambiguity resolves _away from_ `claimed`. An unrecognized status is `unknown`,
never a hit. A false negative costs a lead; a false positive costs an accusation.

### 4.4 Counting and partiality

`counts.unreadable` counts records that produced no usable `site`. If
`unreadable / total > 0.25`, the run is flagged `SH_PARSE_DEGRADED`: results are still shown, with a
banner "NEXUS could not read 118 of 402 records from this Sherlock build. Import with care." and
the raw artifact linked.

`partial` is true when the run was killed by timeout or cancellation, when the egress caps were hit,
or when `counts.total` is less than 50% of the previous run's total for the same digest.

### 4.5 Unrecognizable output

If `shape === 'unknown'`, the run fails with `SH_PARSE` — **no** heuristic scraping of stdout, **no**
partial import. The run drawer offers: download raw JSON, open an issue report with the sanitized
first 4 KB of the artifact, and a link to the digest pinning setting. This is the honest failure the
`00_MASTER.md` §10.5 error rule demands.

---

## 5. Result semantics

### 5.1 What each status means

| Status      | Meaning NEXUS may state                                            | Meaning NEXUS may NOT state                                                      |
| ----------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `claimed`   | "A profile page exists at this URL for this handle."               | "This person has an account here."                                               |
| `available` | "The service reported no profile at this handle at {time}."        | "This person has no account here." (private/renamed/shadowbanned profiles exist) |
| `error`     | "The check failed ({reason}); the result is unknown."              | anything about existence                                                         |
| `unknown`   | "The result could not be interpreted."                             | anything about existence                                                         |
| `illegal`   | "The handle is not valid for this service, so it was not checked." | anything about existence                                                         |

### 5.2 False-positive characteristics

Username enumeration is structurally noisy. Known failure modes, all of which the confidence model
must reflect:

1. **Soft-404s** — a service returns HTTP 200 with a "not found" page; the checker sees 200 and
   reports `claimed`.
2. **Catch-all / vanity routing** — some services render a page for any handle.
3. **Anti-bot interstitials** — CAPTCHA/WAF pages return 200 and look like a hit.
4. **Rate limiting** — bursts of checks cause 429s that may be classified as errors _or_, worse, as
   pages.
5. **Handle recycling** — a claimed profile may belong to a different person than it did last year.
6. **Common handles** — `john`, `admin`, `test` exist on nearly every service and mean nothing.
7. **Geo/consent walls** — different results from different egress IPs.

### 5.3 Confidence model

```
confidence(site) =
  base = 0.55                                          // a raw 'claimed' is a lead, not a fact
  + 0.10 if httpStatus === 200 and the site is in the CURATED_RELIABLE set
  + 0.10 if url host === urlMain host and the url path contains the handle verbatim
  + 0.05 if responseTimeMs is within [50, 10_000]      // implausible timings are suspicious
  - 0.15 if handle length <= 3
  - 0.15 if handle is in COMMON_HANDLES (bundled list of ~500)
  - 0.10 if the run had > 20% error rate                // systemic conditions
  - 0.20 if the site is in the KNOWN_SOFT404 set
clamped to [0.15, 0.80]
```

`confidence` is **capped at 0.80**. NEXUS never assigns higher confidence to a username-enumeration
result, because the tool cannot distinguish "page exists" from "this person owns it". The curated
sets live in `packages/integrations/sherlock/site-quality.ts` as data with a comment citing why each
entry is listed; entries default to neutral (no adjustment) when unknown.

`available` results are stored with `confidence: 0.5` on the _negative_ claim and are **not**
imported as nodes by default (§6.4).

### 5.4 What NEXUS must never assert — and the UI copy that enforces it

Hard rules, encoded as lint-checked copy constants in
`packages/integrations/sherlock/copy.ts`:

- The results panel header is **"Possible profiles — leads, not confirmations"**.
- Every profile node carries a `lead` chip until a human marks it `verified` or `rejected`
  (a first-class `verificationState` on the node: `lead | verified | rejected`, default `lead`).
- The import sheet's footer text, always visible:
  > "Sherlock checks whether a page exists for this handle. It cannot tell you who owns the account.
  > Same handle ≠ same person. Verify before you rely on any of this."
- Export/report rendering (`15_PRESENTATION`) prints the same sentence in the methodology section
  whenever Sherlock-sourced nodes appear.
- The edge from a `username` node to a `profile` node is `has_profile` with the label
  _"handle observed"_, never _"owned by"_.
- Cross-service identity edges are never created automatically. A `same_handle_as` edge between two
  profiles is created only when the user asks, is confidence ≤ 0.6, and renders with a dashed
  stroke and the label "same handle" (`07_EDGE_SYSTEM.md` styling for weak edges).
- Any AI summary of Sherlock results (`14_AI_AGENT.md`) is given the results _and_ these constraints
  in the system prompt, and its output is schema-limited to descriptive fields — it cannot emit an
  attribution statement into a node field.

---

## 6. Graph mapping

### 6.1 Nodes

Source: a `username` node (kind `username`, `data.handle`). Created by the user, by paste, or by
another tool (`12_SPIDERFOOT.md` §6.2 `USERNAME` events).

Produced per `claimed` site:

```ts
export const ProfileDataSchema = z.object({
  kind: z.literal('profile'),
  service: z.string(), // "GitHub"
  serviceHost: z.string().nullable(), // "github.com"
  handle: z.string(),
  url: z.string().url(),
  status: z.enum(['claimed', 'available', 'unknown', 'error', 'illegal']),
  httpStatus: z.number().int().nullable(),
  checkedAt: z.string(), // ISO, = run finishedAt
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  verificationState: z.enum(['lead', 'verified', 'rejected']).default('lead'),
  disappearedAt: z.string().nullable(), // set by diffing, §6.5
  runIds: z.array(z.string().uuid()),
});
```

Derived, opt-in in the import sheet:

| Derived node                                  | Rule                                                                                                                                                            | Default                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `domain` for `serviceHost` registrable domain | one per distinct service host                                                                                                                                   | off (adds ~N domain nodes with little value) |
| `link` node for the profile URL               | only when the user wants the page itself as an artifact                                                                                                         | off                                          |
| `website` unfurl of the profile URL           | requires a separate unfurl job (`06_NODE_SYSTEM.md`) and an extra network fetch **from NEXUS**, which is a different actor than the tool — explicitly consented | off                                          |

### 6.2 Edges

| Edge             | From → To              | Confidence | Notes                                                   |
| ---------------- | ---------------------- | ---------- | ------------------------------------------------------- |
| `has_profile`    | username → profile     | per §5.3   | label "handle observed"; provenance = run               |
| `hosted_on`      | profile → domain       | 0.95       | structural fact from the URL, not an inference          |
| `links_to`       | profile → link/website | 0.9        | only when the URL node was created                      |
| `same_handle_as` | profile ↔ profile     | ≤ 0.6      | user-initiated only (§5.4)                              |
| `checked_by`     | username → run         | —          | run provenance is an envelope field, not a visible edge |

### 6.3 Provenance payload (on every node and edge)

```json
{
  "source": "https://github.com/sherlock-project/sherlock",
  "tool": "sherlock",
  "tool_version": "0.16.0",
  "image_digest": "sha256:…",
  "run_id": "…uuid…",
  "observed_at": "2026-08-17T10:14:22Z",
  "confidence": 0.65,
  "raw_key": "runs/…/sherlock.json#GitHub",
  "method": "username-enumeration",
  "caveat": "page-existence only; not ownership"
}
```

The `caveat` string is rendered verbatim in the provenance popover, so the limitation travels with
the data into exports and other boards.

### 6.4 Import defaults and volume

Sherlock produces ≤ ~400 records, so no staging table is needed (contrast
`12_SPIDERFOOT.md` §7). Still:

- default selection = `claimed` results with `confidence ≥ 0.5`, capped at **60** nodes;
- `available` and `error` results are **not** imported as nodes; they are kept on the run record and
  on the `username` node as `data.negativeChecks` (a compact array of `{site, status, checkedAt}`),
  because "we checked and found nothing" is analytically valuable but must not consume canvas;
- if `claimed > 60`, the excess collapses into one `summary` node
  ("312 more possible profiles · open table") using the same summary node type as
  `12_SPIDERFOOT.md` §7.4;
- layout: profiles arranged in a ring around the username node, ordered by confidence descending,
  radius scaled to count; the whole import is one Y.Doc transaction = one undo step (N3).

### 6.5 Re-run and diff

Re-running Sherlock for a handle produces a `SherlockDiff` against the most recent completed run for
the same `(handle, imageDigest?)` — digest is recorded but not required to match, and a digest
change is noted in the diff header because it can itself explain differences.

```ts
export interface SherlockDiff {
  handle: string;
  previousRunId: string;
  currentRunId: string;
  previousAt: string;
  currentAt: string;
  digestChanged: boolean;
  siteListDelta: { added: string[]; removed: string[] }; // sites the tool itself gained/dropped
  appeared: SherlockSiteResult[]; // available/error/absent -> claimed
  disappeared: SherlockSiteResult[]; // claimed -> available
  becameUnknown: SherlockSiteResult[]; // claimed -> error/unknown  (NOT "disappeared")
  unchanged: number;
}
```

Application rules:

1. **Appeared** → new `profile` nodes, proposed with a `new` badge; edge confidence per §5.3.
2. **Disappeared** → existing profile node is **not deleted** (N8). It gets
   `status: 'available'`, `disappearedAt = now`, renders with 55% opacity and a strikethrough
   service name, and the inspector shows the timeline "claimed 2026-03-02 → not found 2026-08-17".
3. **Became unknown** → node keeps `status: 'claimed'` but gains a `stale` chip and a note
   "last check failed"; a failed check is not evidence of removal. This distinction is the single
   most important behavior in the diff.
4. `siteListDelta` is computed from the union of site names across runs; a site that the tool no
   longer supports is annotated on affected nodes ("no longer checked by this Sherlock version")
   instead of being treated as a disappearance.
5. The diff is rendered as a review sheet before anything is applied, and applying it is one undo
   step.

### 6.6 Watchlist

A `username` node can be added to a watchlist:

```ts
export interface UsernameWatch {
  id: string;
  nodeId: string;
  handle: string;
  projectId: string;
  createdBy: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  sites: string[] | null; // null = full list
  notifyOn: Array<'appeared' | 'disappeared' | 'becameUnknown'>;
  consentId: string; // the standing consent record, §7.2
  pausedAt: string | null;
  lastRunId: string | null;
  nextRunAt: string;
}
```

- Scheduled by a repeatable BullMQ job; jitter ±10% so watches do not stampede.
- Each scheduled run **re-checks consent validity**: a standing consent expires after 90 days and
  the watch auto-pauses with a notification ("Re-confirm authorization to keep monitoring @handle").
- Results are applied as a **pending diff** — never auto-applied. The user gets an in-app
  notification and (optionally) email: "3 changes for @handle — review". Auto-application would
  violate N4.
- The `username` node shows a compact sparkline of profile count over time and the last check time.
- Watch quotas: 25 watches per project, 100 per instance; daily cadence requires an authenticated
  project owner.

---

## 7. Ethics, rate and consent gating

### 7.1 Gating rules

1. Sherlock is **disabled by default** at the instance level
   (`SHERLOCK_ENABLED=false`); an operator must enable it and pin an image digest.
2. A run requires a consent record (§7.2), reusing the `scan_consent` table of
   `12_SPIDERFOOT.md` §5.5 with `tool = 'sherlock'`.
3. Rate limits (§3.2) are per user **and** per handle: the same handle cannot be re-run within
   15 minutes except by an explicit "force re-run" that is recorded in the audit log.
4. NSFW site checking is off by default, requires the per-run toggle, and is recorded in the consent
   record.
5. Minors/sensitive-target policy: the consent dialog requires the analyst to affirm that the target
   is not a minor and that the research has a lawful basis. NEXUS cannot verify this; recording the
   affirmation is the control.
6. Bulk enumeration of many handles is not offered in the UI. The API enforces the same per-user
   quota, so scripting around the UI gains nothing.

### 7.2 Per-run consent record

Extra fields for Sherlock runs, stored in `scan_consent.details jsonb`:

```json
{
  "handle": "example_handle",
  "sitesScope": "all | selected(n)",
  "nsfw": false,
  "purpose": "own-account-audit | authorized-investigation | public-figure-research | other",
  "purposeNote": "free text, max 500 chars",
  "acknowledgedCopyVersion": "sherlock-consent-v1",
  "acknowledgedCopySha256": "…"
}
```

The dialog's exact wording (version `sherlock-consent-v1`), hashed into the record:

> "Sherlock will contact roughly 400 third-party websites and ask whether a page exists for this
> handle. Those sites will see requests from this system. Results show that a page exists — not who
> owns it. You confirm you have a lawful basis to research this handle, that the target is not a
> minor, and that you will treat results as leads requiring verification."

### 7.3 Audit

Every run writes `audit_log` entries: `sherlock.run.requested`, `.started`, `.finished`,
`.imported` (with node counts), `.exported` — each with user, project, handle hash (SHA-256 of the
lowercased handle, so audit browsing does not itself expose targets), and the run id. The plaintext
handle is available only through the run record, which is ACL'd to the project.

---

## 8. Error copy

| Code                    | Title                           | Body                                                                                        | Action                              |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `SH_DISABLED`           | "Sherlock is not enabled"       | "An administrator has not enabled username enumeration on this instance."                   | "Contact admin"                     |
| `SH_INCOMPATIBLE_IMAGE` | "Unsupported Sherlock image"    | "The configured image ({digest}) does not support `--json`, which NEXUS requires."          | "Open settings"                     |
| `SH_CONSENT_REQUIRED`   | "Confirm authorization"         | "This run contacts ~400 external sites. Confirm you have a lawful basis."                   | "Review and confirm"                |
| `SH_QUOTA`              | "Run limit reached"             | "You have run 20 username checks this hour. The limit resets at 15:00."                     | "See run history"                   |
| `SH_RECENT_RUN`         | "Checked recently"              | "@{handle} was checked 4 minutes ago. Re-running now will mostly repeat the same requests." | "Show last result" / "Force re-run" |
| `SH_TIMEOUT`            | "Check timed out"               | "The run hit the {limit} limit. {n} sites were checked; results are partial."               | "Import partial results"            |
| `SH_TOOL_FAILED`        | "Sherlock exited with an error" | "The tool exited with code {code} and produced no results. Last error: {stderrTail}"        | "Open run log"                      |
| `SH_NONZERO_EXIT`       | "Finished with warnings"        | "The tool reported errors for some sites but produced a full result file."                  | "Show details"                      |
| `SH_NO_OUTPUT`          | "No results file"               | "The run finished but wrote no JSON output."                                                | "Open run log"                      |
| `SH_OUTPUT_TOO_LARGE`   | "Result file too large"         | "The output exceeded 32 MB and was not read."                                               | "Download raw"                      |
| `SH_PARSE`              | "Unreadable results"            | "NEXUS did not recognize the structure of this Sherlock build's JSON output."               | "Download raw" / "Report"           |
| `SH_PARSE_DEGRADED`     | "Some results unreadable"       | "{n} of {total} records could not be read. Import with care."                               | "Continue"                          |
| `SH_OOM`                | "Ran out of memory"             | "The run exceeded its 1 GB memory limit and was stopped."                                   | "Retry with fewer sites"            |
| `SH_PROXY_INVALID`      | "Proxy rejected"                | "The proxy address must be a public http, https or socks5 endpoint."                        | "Edit proxy"                        |
| `SH_EGRESS_CAP`         | "Network limit reached"         | "The run reached its request cap ({cap}). Results are partial."                             | "Import partial results"            |

State table for the run surface:

| State                    | UI                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| initial                  | "Run Sherlock" action on any `username` node; handle pre-filled, sites = all                         |
| consent-required         | dialog, primary disabled until the checkbox is set                                                   |
| queued                   | "Queued — 1 run ahead of yours", cancelable                                                          |
| running                  | progress from stdout when `--print-found` is on: "217 / 402 sites · 14 found", elapsed timer, Cancel |
| partial                  | banner + Import                                                                                      |
| success                  | "402 sites checked · 14 possible profiles · 11 s" → review sheet                                     |
| review                   | list grouped by confidence band, each row: service, URL, confidence, `lead` chip, checkbox           |
| empty                    | "No profiles found for @{handle} across 402 sites. That is not proof the handle is unused."          |
| error                    | error strip per the table above                                                                      |
| imported                 | ring layout animation + undo toast "Undid: import 14 profiles for @handle"                           |
| diff-pending (watchlist) | notification card "3 changes for @handle" → diff sheet                                               |

---

## 9. Testing requirements (feeds `18_TESTING.md`)

1. **Parser fixtures**: four JSON shapes (map-of-sites, map-of-usernames, array-of-records,
   garbage), plus records with missing fields, non-numeric `http_status`, relative URLs, `javascript:`
   URLs, a private-IP URL, and 5 MB of records. None may throw; the hostile URLs must be nulled.
2. **Status mapping table test**: every key of `STATUS_MAP` plus 10 unknown strings → `unknown`.
3. **Confidence test**: golden values for a curated site, a soft-404 site, a 3-char handle, and a
   run with a 30% error rate.
4. **Sandbox test**: the container must be non-root, read-only, without `CAP_NET_RAW`, and must fail
   to reach `169.254.169.254` and an RFC1918 address; asserted by an egress-proxy log assertion.
5. **Diff test**: claimed→error must yield `becameUnknown` (stale chip), not `disappeared`; and a
   site removed from the tool's list must not be counted as a disappearance.
6. **Consent test**: a run without a consent record makes zero outbound requests.
7. **Copy test**: a lint rule asserts the strings in `copy.ts` are used verbatim and that no
   Sherlock-sourced UI string contains the words "owns", "belongs to" or "identified as".

---

## 10. Implementation checklist (P11 acceptance)

Ordered, each item independently verifiable; this is the table the phase PR must reproduce with
evidence (`00_MASTER.md` §8).

| #   | Deliverable                                     | File(s)                                      | Acceptance evidence                                                                        |
| --- | ----------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Manifest registered in the integration registry | `packages/integrations/sherlock/manifest.ts` | registry test lists `sherlock` with the declared inputs/permissions                        |
| 2   | Capability probe with per-digest cache          | `.../probe.ts`                               | probe fixture for a compliant image and for an image lacking `--json`                      |
| 3   | Runner execution profile (flags of §3.1)        | `apps/runner/src/profiles/sherlock.ts`       | container inspection test asserts non-root, read-only, cap-drop, pids/mem limits           |
| 4   | Egress policy for the run                       | `apps/runner/src/egress/policy.ts`           | proxy denies RFC1918 + metadata IPs after DNS resolution                                   |
| 5   | Artifact upload + retention                     | `apps/runner/src/artifacts.ts`               | S3 object exists, host dir removed, 30-day lifecycle rule present                          |
| 6   | Schema-tolerant parser                          | `.../parse.ts`                               | the four shape fixtures + hostile-URL fixtures pass, zero throws                           |
| 7   | Confidence model                                | `.../confidence.ts`                          | golden-value test of §5.3                                                                  |
| 8   | Node/edge mapper                                | `.../mapper.ts`                              | fixture run → expected proposal (nodes, edges, provenance incl. `caveat`)                  |
| 9   | Import sheet UI with `lead` framing             | `apps/web/src/features/sherlock/*`           | Playwright: copy strings present, default selection ≤ 60, one undo removes all             |
| 10  | Diff engine                                     | `.../diff.ts`                                | claimed→error ⇒ `becameUnknown`; removed site ⇒ not a disappearance                        |
| 11  | Watchlist scheduling + consent expiry           | `apps/worker/src/jobs/sherlock-watch.ts`     | 90-day expiry auto-pauses; diff is pending, never auto-applied                             |
| 12  | Consent + audit                                 | `apps/api/src/routes/runs.ts`                | run without consent makes zero outbound requests; audit rows written with hashed handle    |
| 13  | Error surface                                   | `.../copy.ts`                                | every code in §8 renders with title/body/action; lint rule for forbidden attribution words |

Non-goals for P11, stated so they are not silently attempted: no page-content fetching for
verification, no multi-handle batch runs, no automatic cross-service identity merging, no
site-list editing UI (the tool's bundled list is used as-is).

---

## Open risks

1. **JSON shape may change between Sherlock versions.** Mitigated by shape detection, per-digest
   caching, and an honest `SH_PARSE` failure rather than a guess. A shape change is a one-file fix
   in the parser, which is exactly the "update only the integration module" property the roadmap
   requires (§12).
2. **Broad egress is unavoidable.** Sherlock must reach hundreds of third-party hosts, so we cannot
   use a tight allowlist like SpiderFoot's. Mitigation: deny-private-ranges after DNS resolution,
   request/byte caps, per-run rate limiting, and full logging. This is the weakest isolation point
   in NEXUS and is flagged as such in `15_SECURITY.md`.
3. **False positives are inherent.** Soft-404s and anti-bot pages cannot be reliably distinguished
   without fetching and analyzing page content, which NEXUS deliberately does not do (it would turn
   a metadata check into content scraping). The 0.80 confidence cap and the `lead` verification
   state are the compensating controls.
4. **The site list quality varies** across the ~400 supported sites; our `CURATED_RELIABLE` and
   `KNOWN_SOFT404` sets are maintained by us and will lag upstream additions. Unknown sites get
   neutral treatment, so the model degrades gracefully.
5. **Watchlist creates a standing, repeated external footprint** against third parties. Mitigated by
   90-day consent expiry, cadence limits, quotas and pause-on-expiry — but operators should
   understand that a daily watch is ~146,000 third-party requests per year per handle.
6. **Handle recycling** means a profile verified today may be a different person next year.
   `lastSeenAt` and diffing surface change, but nothing detects a silent ownership transfer.
   The `caveat` provenance string is the only durable defense.
7. **Image digest pinning versus freshness**: pinning protects reproducibility but freezes the site
   list. Recommendation encoded in `19_DEPLOYMENT.md`: review the pinned digest quarterly and record
   the review date next to the pin.
