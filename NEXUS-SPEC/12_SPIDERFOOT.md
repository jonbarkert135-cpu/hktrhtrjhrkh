# NEXUS — 12 — SPIDERFOOT INTEGRATION

## Scope

Specifies the SpiderFoot integration: an honest maturity assessment and its consequences, the two
supported deployment models (user-provided instance / NEXUS-managed container), the `SpiderFootClient`
adapter with a mandatory capability probe, scan configuration UX with a legal consent gate, the
event-type → NEXUS entity mapping with confidence and dedupe rules, and volume control so a scan
that emits tens of thousands of events never floods the canvas.
Ships in phase **P12** (`00_MASTER.md` §7) on the pipeline of `10_INTEGRATIONS.md`. Execution is
always inside the sandboxed runner (N5); every imported node arrives via a Proposal (N4).

---

## 1. Maturity assessment (read this before implementing)

Verified facts (as of 2026-08-17):

- Repository `smicallef/spiderfoot`, **MIT** license.
- Stable version **v4.0**, Python.
- Interfaces: a web UI + an HTTP API served by the `sfwebui` server, an interactive client
  `sfcli.py`, and a CLI `sf.py`.
- **deps.dev (June 2026) reports 0 commits and 0 issue activity in the preceding 90 days** —
  i.e. LOW recent maintenance activity.

Applying the maintenance-risk formula of `11_GITHUB.md` §5.8 to those signals yields band
**`unmaintained`**. That is a statement about *recent activity*, not about code quality: v4.0 is a
widely deployed, functional tool. But for NEXUS it has hard consequences.

### 1.1 Consequences

| Consequence | Why | Our response |
|---|---|---|
| No upstream fixes expected on our timeline | zero recent activity | never block a NEXUS release on an upstream PR; fork-and-patch is the escalation path |
| Security patches may not arrive | same | strict network isolation (§3.3); the container never gets credentials to anything but the targets the user authorized |
| API shape may be undocumented / may differ per build | web-UI-first project, no published stable API contract we can verify | **every endpoint shape is an assumption validated by the capability probe** (§4.2); nothing is called before the probe classifies it |
| Python dependency rot (old pins) | unmaintained deps | pinned image digest, no `pip install` at runtime, `--read-only` FS |
| Feature may need removal one day | project could be archived | adapter isolation: deleting `packages/integrations/spiderfoot/` must leave NEXUS compiling and every already-imported node intact |

### 1.2 Mitigation plan (all mandatory)

1. **Pinned image digest.** The managed deployment uses a digest, not a tag:
   `spiderfoot@sha256:<digest>` recorded in `packages/integrations/spiderfoot/pinned.ts` with the
   date it was pinned and the SHA of the source ref it was built from. Upgrades are a deliberate PR
   that re-runs the probe fixture suite. If the operator has not configured a digest, the managed
   mode is **disabled** (not "falls back to `:latest`").
2. **Adapter isolation.** All SpiderFoot knowledge lives in
   `packages/integrations/spiderfoot/`. The only exports the rest of NEXUS may import are
   `manifest`, `runSpiderFootScan` (a job handler) and the mapping table. No SpiderFoot type
   appears in `packages/domain`.
3. **Capability probe at install and at every connect** (§4.2). The probe result drives feature
   availability; unprobed capability = unavailable capability.
4. **Documented fallback path** when the probe fails or the instance is gone:
   - `fallback.tier1` — run the *individual* capability with a first-party NEXUS module instead:
     DNS/whois/passive-DNS/certificate-transparency lookups are implemented natively in
     `packages/integrations/netrecon/` (phase P12b, HTTP-only, no third-party code) and cover the
     domain/hostname/IP families of §6.
   - `fallback.tier2` — username enumeration falls back to Sherlock (`13_SHERLOCK.md`), which is
     actively maintained.
   - `fallback.tier3` — the integration reports `unavailable` with the exact reason, and the
     Scan button becomes "SpiderFoot unavailable — see why", never a silent no-op.
5. **Data durability independent of the tool.** Everything imported from SpiderFoot is normal
   NEXUS graph data with provenance. Removing the integration never deletes nodes.
6. **No auto-update.** The managed container is never pulled at runtime by tag; the runner refuses
   to start an image whose digest differs from the pinned one.

---

The manifest for SpiderFoot parses through `zIntegrationManifest` (`10_INTEGRATIONS.md` §4.1) with
`maturity: 'beta'`, `risk.label: 'high'`, `risk.upstreamMaintenance: 'low'` and a `risk.fallback`
string naming the tiers of §1.2 — those three fields are what drive the warning UI, so they are not
optional for this integration.

---

## 2. Position in the pipeline

```text
UI (scan config)  →  api (validate + consent record)  →  BullMQ `spiderfoot.scan`
   → worker orchestrator → SpiderFootClient (managed | remote)
   → event stream/poll → parser → entity extractor → mapper
   → staged import buffer (Postgres) → Import Proposal → canvas
```

The worker never writes nodes directly (N4). Results accumulate in a **staging table** and become
canvas nodes only when the user accepts a proposal — which is what makes volume control (§7)
possible at all.

---

## 3. Deployment models

Both are supported; the project setting `spiderfoot.mode` is `'remote' | 'managed' | 'disabled'`
(default `'disabled'` — an OSINT tool is never on by default).

### 3.1 Mode `remote` — user-provided instance

Configuration (per project, stored encrypted like §3.4 of `11_GITHUB.md`):

```ts
export interface SpiderFootRemoteConfig {
  baseUrl: string;                 // https://sf.internal.example:5001
  auth: { kind: 'none' } | { kind: 'basic'; username: string; password: string }
       | { kind: 'header'; header: string; value: string };
  tlsFingerprintSha256?: string;   // optional pinning for self-signed instances
  verifyTls: boolean;              // default true; false requires an explicit acknowledgement
  timeoutMs: number;               // default 30_000 per request
}
```

Rules:
- The base URL is validated by the SSRF guard (N7, `15_SECURITY.md` §6) at configure time **and**
  at every request (DNS re-resolution + pinning). Private ranges are allowed **only** when the
  operator sets `ALLOW_PRIVATE_INTEGRATION_TARGETS=true`; this is exactly the case where a user
  legitimately runs SpiderFoot on the LAN, so it is a deliberate operator opt-in with an audit
  entry, not a blanket exemption.
- All calls originate from the worker over the egress proxy with an allowlist containing exactly
  the configured host:port.
- We never proxy the SpiderFoot web UI through NEXUS. "Open in SpiderFoot" is a plain external link
  with `rel="noopener noreferrer"` (roadmap §11 requirement) plus the scan id when the probe
  determined a stable UI route; otherwise it links to the instance root.

### 3.2 Mode `managed` — NEXUS-started container

Started by the runner as a per-scan ephemeral container.

```
docker run --rm \
  --name nexus-sf-{runId} \
  --user 65532:65532 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --tmpfs /home/sf:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 512 \
  --memory 2g --memory-swap 2g --cpus 2 \
  --network nexus-egress \                # proxy-only network, see §3.3
  --env HTTP_PROXY=http://egress:3128 --env HTTPS_PROXY=http://egress:3128 \
  --mount type=bind,src=/var/nexus/runs/{runId},dst=/out,rw \
  spiderfoot@sha256:{PINNED_DIGEST} \
  {argv}
```

In Kubernetes the same is expressed with `runtimeClassName: gvisor`, a read-only root filesystem,
`runAsNonRoot: true`, `seccompProfile: RuntimeDefault`, dropped capabilities and an emptyDir
`medium: Memory` workdir (`00_MASTER.md` §2, runner row; details in `19_DEPLOYMENT.md` §5).

Two managed sub-modes, chosen by the probe:

| Sub-mode | How | When |
|---|---|---|
| `managed-web` | container runs the `sfwebui` server bound to `127.0.0.1` inside the container's netns, and the runner talks to it over the container port for the scan lifetime | probe confirms the HTTP surface answers |
| `managed-cli` | container runs the `sf.py` CLI once per scan and writes results to `/out/result.{json,csv}` | probe could not confirm a usable HTTP surface, or the operator forces CLI |

`managed-cli` is the **more robust** mode (a process + a file is a smaller contract than an
undocumented HTTP API) and is the default when both are available. `managed-web` exists because it
gives incremental results during long scans; `managed-cli` gives them only at the end (§4.6).

Hard timeout: `scan.timeoutMs`, default 30 min, max 4 h. On timeout the runner sends SIGTERM, waits
10 s, then SIGKILL, and any partial output already written is still parsed and offered for import
(labelled "partial — scan timed out").

### 3.3 Network isolation and legal gating

- The container has **no direct internet access**. All egress goes through the NEXUS egress proxy,
  which enforces:
  - a per-run allowlist derived from the scan target (the target domain and its subdomains, plus a
    fixed list of OSINT data sources the selected modules require — the module→hosts table is built
    from the probe's module metadata and, where unavailable, defaults to "deny and log", so a module
    that needs an unknown host simply produces no results rather than opening the network);
  - a hard cap: `EGRESS_MAX_REQUESTS = 20_000` and `EGRESS_MAX_BYTES = 512 MB` per run;
  - denial of RFC1918/loopback/link-local/metadata (`169.254.169.254`) destinations, always,
    including in `remote` mode's own target resolution.
- Every blocked destination is recorded and shown in the run report ("14 requests blocked by the
  egress policy") so the analyst understands why a module returned nothing.
- **Legal gate** (`00_MASTER.md` §3.6, `15_SECURITY.md` §9): an active scan requires a stored
  consent record (§5.5). Scanning is an active operation against third-party infrastructure; NEXUS
  refuses to run "invasive" modules unless the user has affirmed authorization for that specific
  target, and the affirmation is written to the audit log with user id, target, timestamp and the
  free-text engagement reference.

---

## 4. Adapter design

### 4.1 Interface

```ts
// packages/integrations/spiderfoot/client/types.ts
export interface SpiderFootClient {
  probe(signal: AbortSignal): Promise<SpiderFootCapabilities>;
  listModules(signal: AbortSignal): Promise<SpiderFootModule[]>;
  createScan(req: CreateScanRequest, signal: AbortSignal): Promise<ScanHandle>;
  getStatus(scanId: string, signal: AbortSignal): Promise<ScanStatus>;
  fetchEvents(scanId: string, cursor: EventCursor | null, limit: number,
              signal: AbortSignal): Promise<EventPage>;
  fetchCorrelations(scanId: string, signal: AbortSignal): Promise<RawCorrelation[]>;
  cancel(scanId: string, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;                      // stops a managed container, closes sockets
}

export interface SpiderFootCapabilities {
  probedAt: string;
  transport: 'http' | 'cli';
  reachable: boolean;
  version: string | null;                      // parsed from the instance, null if unknown
  versionSource: 'api' | 'cli' | 'banner' | 'unknown';
  modules: SpiderFootModule[];                 // may be [] when unlistable
  supports: {
    createScan: boolean;
    statusPolling: boolean;
    incrementalEvents: boolean;                // events readable while the scan runs
    correlations: boolean;
    cancel: boolean;
    csvExport: boolean;
    jsonExport: boolean;
  };
  endpointMap: Record<KnownOperation, string | null>;   // resolved paths, null = unsupported
  notes: string[];                             // human-readable probe findings
}

export interface SpiderFootModule {
  name: string;                                // e.g. sfp_dnsresolve
  descr: string | null;
  categories: string[];
  consumes: string[];                          // event types, when the instance reports them
  produces: string[];
  flags: string[];                             // e.g. invasive/slow/apikey — when reported
  requiresApiKey: boolean | null;              // null = unknown
}

export interface CreateScanRequest {
  name: string;
  target: string;
  targetType: TargetType;
  moduleNames: string[] | null;                // null = use-case selection
  useCase: 'passive' | 'footprint' | 'investigate' | 'all' | null;
  options: Record<string, string | number | boolean>;
}

export interface ScanHandle { scanId: string; startedAt: string; }

export interface ScanStatus {
  scanId: string;
  state: 'created' | 'starting' | 'running' | 'finished' | 'aborted' | 'failed' | 'unknown';
  raw: string;                                 // instance's own status string, preserved
  startedAt: string | null;
  endedAt: string | null;
  eventCount: number | null;
  errorMessage: string | null;
}

export interface RawEvent {
  id: string | null;
  type: string;                                // SpiderFoot event type, verbatim
  data: string;
  module: string | null;
  sourceEventId: string | null;
  sourceData: string | null;
  generatedAt: string | null;                  // ISO, normalized from whatever we receive
  falsePositive: boolean | null;
  risk: string | null;
  raw: unknown;                                // untouched original record
}

export interface EventPage { events: RawEvent[]; nextCursor: EventCursor | null; done: boolean; }
export type EventCursor = { kind: 'offset'; offset: number } | { kind: 'time'; after: string }
                        | { kind: 'opaque'; token: string };
```

Error types:

```ts
export type SpiderFootErrorCode =
  | 'SF_UNREACHABLE' | 'SF_AUTH' | 'SF_TLS' | 'SF_UNSUPPORTED_OPERATION'
  | 'SF_PROBE_FAILED' | 'SF_SCAN_REJECTED' | 'SF_SCAN_FAILED' | 'SF_TIMEOUT'
  | 'SF_PARSE' | 'SF_CANCELED' | 'SF_LIMIT_EXCEEDED' | 'SF_IMAGE_NOT_PINNED';

export class SpiderFootError extends Error {
  constructor(readonly code: SpiderFootErrorCode, message: string,
              readonly detail?: { httpStatus?: number; bodySnippet?: string; operation?: string }) { super(message); }
}
```

Two implementations: `HttpSpiderFootClient` (modes `remote`, `managed-web`) and
`CliSpiderFootClient` (mode `managed-cli`). Both must pass the same contract test suite against
recorded fixtures (`18_TESTING.md`).

### 4.2 Capability probe — the heart of the adapter

> **Statement of assumptions.** SpiderFoot's HTTP surface is served by its web UI server and is not
> a published, versioned API contract that we have verified. Therefore **every endpoint path and
> payload shape below is an assumption**. The adapter must not call any operation whose shape the
> probe has not confirmed; unconfirmed operations are reported as unsupported and the affected
> feature degrades per §4.7.

Probe algorithm (HTTP transport):

```
1. GET {baseUrl}/ with timeout 10s
   - non-2xx/3xx or network error -> SF_UNREACHABLE, capabilities.reachable = false
   - 401/403 -> SF_AUTH
   - TLS error -> SF_TLS (with fingerprint shown so the user can pin it)
2. Version discovery, first hit wins:
   a. any JSON body field matching /version/i
   b. HTML title/footer matching /SpiderFoot\s*v?([0-9]+\.[0-9]+(\.[0-9]+)?)/
   c. an endpoint from CANDIDATE_PATHS.ping that returns JSON containing a version
   -> version, versionSource; if none: version=null, versionSource='unknown' (NOT fatal)
3. Operation discovery. For each KnownOperation, try its CANDIDATE_PATHS in order:
   send the least destructive probe (GET or a HEAD-equivalent, never a scan start),
   classify the response:
     JSON array/object with the expected key shape -> supported, record path + shape id
     HTML                                            -> unsupported via this path
     404/405                                         -> try next candidate
   Record the winning path in endpointMap; null if all candidates fail.
4. Module list: if endpointMap.listModules is set, fetch and normalize into SpiderFootModule[]
   using a tolerant reader (§4.3). If unavailable, modules = [] and the UI falls back to
   use-case selection only (§5.2).
5. Shape confirmation for events: run a *read* against any existing finished scan if one is
   listable; otherwise mark `incrementalEvents` as 'unconfirmed' and confirm it lazily during the
   first real scan (first successful page confirms; a failure downgrades to end-of-scan export).
6. Persist SpiderFootCapabilities with a 24h TTL; re-probe on TTL expiry, on any SF_PARSE, or on
   explicit user action.
```

`KnownOperation` is the closed set `'ping' | 'listModules' | 'createScan' | 'scanStatus' |
'scanEvents' | 'scanCorrelations' | 'cancelScan' | 'exportJson' | 'exportCsv'`. Candidate paths are
data in `packages/integrations/spiderfoot/client/candidates.ts` so that adapting to a different
build is editing one file, never touching logic.

For the CLI transport the probe is:

```
run: {sf.py|spiderfoot} --help   (in the sandbox, network none, 20s timeout)
  - parse the flag list; require at least: target flag, module/use-case flag, an output-format flag
  - transport='cli', supports.incrementalEvents=false, supports.correlations=false unless a
    correlation flag appears in --help
  - version: parse a version line if printed; else null
  - any non-zero exit or unparseable help -> SF_PROBE_FAILED, integration marked unavailable
```

### 4.3 Tolerant readers

Every payload is read by a *shape-tolerant* reader, never a strict schema:

```ts
// reads a record whether it is an object with named keys or a positional array
export function readEvent(rec: unknown): RawEvent | null {
  if (Array.isArray(rec)) return readPositionalEvent(rec);
  if (rec && typeof rec === 'object') return readKeyedEvent(rec as Record<string, unknown>);
  return null;
}

function readKeyedEvent(o: Record<string, unknown>): RawEvent | null {
  const type = pickString(o, ['type', 'eventType', 'event_type', 'etype']);
  const data = pickString(o, ['data', 'value', 'eventData', 'event_data']);
  if (!type || data === null) return null;                 // unusable record: counted, not thrown
  return {
    id: pickString(o, ['id', 'eventId', 'hash']),
    type, data,
    module: pickString(o, ['module', 'sourceModule', 'src_module']),
    sourceEventId: pickString(o, ['sourceEvent', 'source_event', 'parentId']),
    sourceData: pickString(o, ['sourceData', 'source_data', 'parentData']),
    generatedAt: normalizeTime(pickAny(o, ['generated', 'created', 'timestamp', 'lastSeen'])),
    falsePositive: pickBool(o, ['falsePositive', 'fp']),
    risk: pickString(o, ['risk', 'severity']),
    raw: o,
  };
}
```

Positional records are mapped by an **index map learned during the probe** from a sample record
whose fields we can classify (a 32/40-hex id, an ISO/epoch timestamp, a known event-type token). If
the index map cannot be learned, positional pages are rejected with `SF_PARSE`, the raw page is
stored for diagnostics, and the run degrades to the export path.

Unusable-record accounting: `parsedOk`, `parsedSkipped`, `parseErrors[]` are part of the run record
and shown in the import UI ("38,204 events read, 12 records unreadable").

### 4.4 Scan creation

```
createScan(req):
  assert capabilities.supports.createScan else SF_UNSUPPORTED_OPERATION
  assert consentRecordExists(runId) else SF_SCAN_REJECTED  (§5.5)
  body = buildCreateBody(req, capabilities)     // form-encoded and JSON attempts, in that order
  POST endpointMap.createScan
  extract scanId: JSON field matching /scan.?id|id$/, else a redirect Location containing an id,
                  else an id token in the HTML response
  if no id can be extracted -> SF_PARSE (and, if the request may still have started a scan,
     immediately attempt cancel-by-name and surface a warning: "a scan may be running on the
     instance; NEXUS lost track of it")
```

CLI transport instead builds argv from the probed flags and streams stdout to
`/out/scan.stdout.log`, with the structured output written to `/out/result.json`.

### 4.5 Status polling

```
interval(t) = 2s for t < 60s, 5s for t < 10min, 15s afterwards      (bounded backoff)
stop on: state in {finished, aborted, failed} | job canceled | hard timeout
consecutive status failures: 3 -> mark state 'unknown', keep polling at 30s up to 10 min,
                             then fail the run with SF_TIMEOUT (partial results still importable)
```

### 4.6 Event retrieval

Two strategies, selected by `supports.incrementalEvents`:

| Strategy | Behavior |
|---|---|
| `incremental` | after each status poll, `fetchEvents(scanId, cursor, 500)` until `done`; each page is normalized, deduped and written to the staging table; the UI counter and the family histogram update live |
| `terminal` | wait for `finished`, then read the JSON export (or CSV if `jsonExport` is false) in one pass, streaming-parsed so a 500 MB export never lands in memory |

Cursor handling: offset cursors are re-validated by checking that the first record of page *n+1*
differs from the last record of page *n*; if the instance ignores the offset (a real risk with an
unverified API), the adapter detects the repeat, switches to `terminal` strategy, and logs
`notes: ['offset paging not honored; switched to terminal export']`.

Streaming parse limits: `MAX_EVENTS_PER_RUN = 250_000` and `MAX_EXPORT_BYTES = 512 MB`. Exceeding
either stops ingestion with `SF_LIMIT_EXCEEDED`, keeps everything read so far, and tells the user
to narrow the scan.

### 4.7 Cancellation, timeouts, degradation

- `cancel()` is called on: user cancel, job timeout, worker shutdown (SIGTERM handler), and board
  deletion. In managed mode, cancellation additionally kills the container — so cancellation works
  even when `supports.cancel === false`.
- If `supports.cancel === false` in remote mode, the UI says exactly that: "This SpiderFoot
  instance does not expose a cancel endpoint. NEXUS stopped collecting results; the scan may
  continue on the instance." Never a fake success.
- Degradation matrix:

| Missing capability | Effect | UI copy |
|---|---|---|
| `listModules` | module picker replaced by use-case picker | "This instance did not report its module list. Choose a scan profile instead." |
| `incrementalEvents` | results appear only at the end; live counter shows "collecting…" | "Live results are unavailable on this instance; results will appear when the scan finishes." |
| `correlations` | no cluster nodes; grouping falls back to our own family grouping (§7.4) | "Correlations are unavailable; NEXUS grouped results by type." |
| `cancel` | see above | as above |
| `createScan` | integration unusable for scanning; existing results remain browsable | "This instance cannot start scans from NEXUS. Use fallback tools or run the scan in SpiderFoot and import the export." |
| all | integration `unavailable` | "SpiderFoot is not reachable — {reason}. Fallbacks: native DNS/WHOIS recon, Sherlock for usernames." |

Manual export import is always available as the ultimate fallback: drag a SpiderFoot JSON/CSV
export onto the canvas and the same parser/mapper/proposal path runs with
`provenance.transport = 'manual-import'`.

---

## 5. Scan configuration UX

### 5.1 Target type detection

```ts
export type TargetType = 'DOMAIN_NAME' | 'INTERNET_NAME' | 'IP_ADDRESS' | 'NETBLOCK_OWNER'
                       | 'EMAILADDR' | 'USERNAME' | 'HUMAN_NAME' | 'PHONE_NUMBER' | 'BITCOIN_ADDRESS';

export function detectTargetType(input: string): { type: TargetType; confidence: number }[]
```

Detection order (first match wins, but all plausible types are offered as chips the user can
switch): CIDR → `NETBLOCK_OWNER`; IPv4/IPv6 literal → `IP_ADDRESS`; contains `@` and a valid domain
part → `EMAILADDR`; `+`/digits ≥ 8 with phone shape → `PHONE_NUMBER`; base58 34-char or bech32 →
`BITCOIN_ADDRESS`; registrable domain with no subdomain → `DOMAIN_NAME`; hostname with subdomain →
`INTERNET_NAME`; two capitalized words → `HUMAN_NAME`; `^[a-z0-9._-]{2,30}$` → `USERNAME`.
Ambiguity (e.g. `john.smith` is both a username and a hostname-ish string) always surfaces chips;
NEXUS never silently picks one.

When the scan is started from a node, the target and type are pre-filled from the node kind and the
node id is recorded as `originNodeId` so imported nodes are placed near it and linked to it.

### 5.2 Profile / module selection

Two-level control:

1. **Profile** (always available): `Passive` (default), `Footprint`, `Investigate`, `All`.
   Each profile maps to a module set when the module list is known, otherwise to the instance's own
   use-case parameter. `Passive` is the default because it is the only profile that does not touch
   the target directly.
2. **Modules** (only when `listModules` succeeded): a searchable list grouped by category, with
   per-module badges: `invasive`, `slow`, `needs API key`, and `no API key configured` (derived by
   asking the instance for module options where available; when unknown, the badge reads
   "key requirement unknown"). Modules requiring keys that are not configured are shown disabled
   with "This module needs an API key configured on the SpiderFoot instance."

Invasive modules require a second toggle ("I am authorized to actively probe this target") which is
part of the consent record.

### 5.3 Scope and limits

| Control | Default | Range | Effect |
|---|---|---|---|
| Max runtime | 30 min | 5 min – 4 h | hard timeout (§3.2) |
| Max events imported | 5,000 | 500 – 50,000 | staging cap; excess is summarized (§7) |
| Max requests (egress) | 20,000 | 1,000 – 100,000 | egress proxy cap |
| Crawl depth (when the instance exposes it) | 2 | 0–4 | passed through as an option |
| Rate limit | 5 req/s to any single target host | 1–20 | enforced by the egress proxy, not by trust in the tool |
| Subdomain expansion | on | on/off | when off, `INTERNET_NAME` events are grouped rather than expanded |

### 5.4 Estimated duration

Shown before starting, computed from a local model, and explicitly labeled an estimate:

```
estimateMs = base(profile) * moduleFactor * targetFactor
base:        passive 4min | footprint 12min | investigate 25min | all 45min
moduleFactor = 0.5 + 0.5 * (selectedModules / knownModules)   (1.0 when unknown)
targetFactor = DOMAIN 1.0 | INTERNET_NAME 0.8 | IP 0.7 | NETBLOCK 2.0 | EMAIL 0.6
             | USERNAME 0.6 | HUMAN_NAME 1.2 | PHONE 0.5 | BITCOIN 0.5
display: "Typically 8–20 min. This is an estimate; the scan stops at your 30 min limit."
```

After each completed run we store `(profile, targetType, moduleCount, actualMs)` and, once an
instance has ≥ 5 runs, the estimate becomes the median of comparable local runs — a self-calibrating
estimate that never claims precision it does not have.

### 5.5 Consent gate and record

The scan cannot start without a consent record:

```sql
CREATE TABLE scan_consent (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL UNIQUE REFERENCES integration_runs(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  project_id     uuid NOT NULL,
  tool           text NOT NULL,                 -- 'spiderfoot'
  target         text NOT NULL,
  target_type    text NOT NULL,
  invasive       boolean NOT NULL,
  authorization_basis text NOT NULL,            -- 'own-asset' | 'written-authorization' | 'public-data-only'
  engagement_ref text,                          -- free text: ticket, contract, case id
  acknowledged_text_sha256 bytea NOT NULL,      -- hash of the exact wording shown
  created_at     timestamptz NOT NULL DEFAULT now(),
  ip             inet,
  user_agent     text
);
```

The dialog states, in plain language: what will be sent where, that active modules contact the
target directly, that the user is responsible for authorization, and which jurisdictional caveats
apply generically (no legal advice). The checkbox is not pre-checked, and the acknowledgement text
is versioned by hash so an audit can reconstruct exactly what was agreed.

### 5.6 States

| State | UI |
|---|---|
| initial | target field focused, profile `Passive`, "Start scan" disabled until target valid + consent checked |
| validating | inline spinner in the target field, ≤ 300 ms, target-type chips resolve |
| consent-required | "Start scan" disabled with the reason under it, consent block highlighted |
| starting | button → "Starting…", cancel available immediately |
| running | run drawer with elapsed time, event counter, family histogram, module progress if reported, "Cancel scan" |
| partial | after cancel/timeout: "Partial results — 3,412 events collected before the scan stopped" + Import |
| finished | "Scan finished in 11:42 · 38,204 events · 6 families" + "Review import" |
| failed | error strip with code + reason + "Retry" and "Open run log" |
| empty | "The scan finished without producing events. 14 requests were blocked by the egress policy; 3 modules needed API keys." |
| importing | proposal sheet (§7.5) |
| imported | canvas focus animation on the new cluster; undo toast "Undid: import 214 nodes from SpiderFoot scan" |

---

## 6. Result mapping

### 6.1 Principles

1. SpiderFoot event types are **strings we do not control**. The mapping table is data
   (`packages/integrations/spiderfoot/mapping.ts`), matched by exact type first, then by a prefix
   rule set, then by family fallback. An unknown type is never dropped — it becomes an
   `observation` node in the "Unmapped" group, retaining type and data verbatim.
2. Every produced node carries full provenance: `tool: 'spiderfoot'`, `run_id`, `module`,
   `sf_event_type`, `observed_at`, `confidence`, and an S3 key to the raw record.
3. Nothing is asserted as fact. A SpiderFoot event is an **observation by a module**, not truth.

### 6.2 Mapping table (common families)

| SpiderFoot event type (exact or prefix) | Family | NEXUS node kind | Edge from source node | Base confidence |
|---|---|---|---|---|
| `DOMAIN_NAME` | domain | `domain` | `resolves_to` / `related_to` | 0.9 |
| `DOMAIN_NAME_PARENT` | domain | `domain` | `parent_of` (reversed) | 0.9 |
| `SIMILARDOMAIN`, `CO_HOSTED_SITE_DOMAIN` | related domain | `domain` | `similar_to` / `co_hosted_with` | 0.45 |
| `INTERNET_NAME`, `INTERNET_NAME_UNRESOLVED` | hostname | `hostname` | `subdomain_of` | 0.85 / 0.6 |
| `IP_ADDRESS`, `IPV6_ADDRESS` | ip | `ip_address` | `resolves_to` | 0.9 |
| `NETBLOCK_OWNER`, `NETBLOCK_MEMBER`, `BGP_AS_OWNER`, `BGP_AS_MEMBER` | netblock | `netblock` / `asn` | `announced_by` / `member_of` | 0.8 |
| `EMAILADDR`, `EMAILADDR_GENERIC` | email | `email` | `associated_with` | 0.75 / 0.4 |
| `EMAILADDR_COMPROMISED` | breach | `breach_record` | `exposed_in` | 0.7 |
| `USERNAME` | username | `username` | `uses_handle` | 0.6 |
| `ACCOUNT_EXTERNAL_OWNED`, `SOCIAL_MEDIA` | social profile | `profile` | `has_profile` | 0.55 |
| `LINKED_URL_INTERNAL`, `LINKED_URL_EXTERNAL`, `URL_*` | url | `link` | `links_to` | 0.8 / 0.5 |
| `WEBSERVER_BANNER`, `WEBSERVER_TECHNOLOGY`, `SOFTWARE_USED` | technology | `technology` | `runs` | 0.7 |
| `VULNERABILITY_*`, `VULNERABILITY_CVE_*` | vulnerability | `vulnerability` | `affected_by` | 0.6 |
| `TCP_PORT_OPEN`, `TCP_PORT_OPEN_BANNER`, `UDP_PORT_*` | service | `service` | `exposes` | 0.85 |
| `SSL_CERTIFICATE_ISSUED`, `SSL_CERTIFICATE_*` | certificate | `certificate` | `secured_by` | 0.85 |
| `PHYSICAL_ADDRESS`, `PHYSICAL_COORDINATES`, `GEOINFO` | location | `location` | `located_at` | 0.5 |
| `HUMAN_NAME` | person | `person` | `mentions` | 0.4 |
| `PHONE_NUMBER` | phone | `phone` | `associated_with` | 0.6 |
| `COMPANY_NAME` | org | `organization` | `associated_with` | 0.5 |
| `RAW_*`, `*_CONTENT`, `SEARCH_ENGINE_WEB_CONTENT` | raw | **not imported as nodes**; stored as run artifacts only | — | — |
| `DARKNET_MENTION_*`, `LEAKSITE_*` | mention | `observation` | `mentioned_in` | 0.4 |
| `MALICIOUS_*`, `BLACKLISTED_*` | reputation | attribute on the target node (`reputation[]`), not a node | — | 0.6 |
| anything else | unknown | `observation` (Unmapped group) | `derived_from` | 0.3 |

Prefix rules applied before the fallback, in order:
`VULNERABILITY_*` → vulnerability; `SSL_CERTIFICATE_*` → certificate; `MALICIOUS_*`/`BLACKLISTED_*`
→ reputation attribute; `RAW_*` → artifact-only; `*_URL`/`URL_*` → url; `SOCIAL_*`/`ACCOUNT_*` →
social profile.

Every row of the table has a fixture test: a synthetic event of that type must produce exactly the
listed node kind, edge and confidence.

### 6.3 Confidence derivation

```
confidence = clamp(base(eventType)
                 * moduleTrust(module)
                 * depthDecay(hopsFromTarget)
                 * (falsePositive ? 0.2 : 1)
                 * corroborationBoost(n), 0.05, 0.95)

moduleTrust:   authoritative lookups (DNS, WHOIS, certificate transparency, RDAP) 1.0
               aggregator/third-party API                                        0.9
               search-engine derived                                             0.75
               content scraping / regex extraction                               0.6
               unknown module                                                    0.8
depthDecay:    1.0, 0.9, 0.8, 0.7, then 0.6 for hops >= 4
corroboration: 1 source 1.0 | 2 sources 1.08 | >=3 sources 1.15
```

`moduleTrust` is a table keyed by module name with a default of 0.8; unknown module names are
therefore neither privileged nor punished. Confidence is **never 1.0** for SpiderFoot output —
NEXUS reserves 1.0 for direct observation of an authoritative API by NEXUS itself
(`11_GITHUB.md` §4.1).

Confidence is rendered as a 4-step band in the UI (`low < 0.4`, `medium < 0.65`, `high < 0.85`,
`very high`) with the numeric value in the tooltip and the full derivation in the provenance panel:
"0.68 = base 0.85 (INTERNET_NAME) × module 0.9 (sfp_crt) × depth 0.9 (2 hops)".

### 6.4 Dedupe

Canonical identity key per kind, computed before staging:

| Kind | Key |
|---|---|
| `domain` / `hostname` | `dns:{lowercased, IDNA-normalized, trailing-dot-stripped name}` |
| `ip_address` | `ip:{normalized: IPv6 compressed lowercase, IPv4 dotted}` |
| `email` | `email:{lower(local)}@{lower(domain)}` (dots in gmail local parts are **not** collapsed — that is an assumption about a provider, not a fact about the address) |
| `username` | `handle:{lower(handle)}` — note: same handle ≠ same person (§6.6) |
| `link` | `url:{scheme://host/path?sortedQuery}` minus tracking params (`utm_*`, `fbclid`, `gclid`) |
| `profile` | `profile:{service}:{lower(handle)}` |
| `certificate` | `cert:{sha256 fingerprint}` when present, else `cert:{issuer}|{serial}` |
| `vulnerability` | `vuln:{CVE-ID}` when present, else `vuln:{sha256(type+data)}` |
| `service` | `svc:{ip}:{port}/{proto}` |
| `location` | `loc:{normalized address string}` (never geocoded by us) |
| `person` | never auto-deduped; see §6.6 |
| `observation` | `obs:{sha256(type + data)}` |

Dedupe happens in three places:
1. **within the page** (hash set),
2. **within the run** (staging table unique index on `(run_id, entity_key)` with a `hit_count`
   column and a `sources[]` array — this is what feeds `corroborationBoost`),
3. **against the board** at proposal time (`nodes.external_key` lookup). An existing node is
   *enriched* (new provenance entry, possibly higher confidence, new attributes) rather than
   duplicated, and the proposal shows it in an "Updates to 14 existing nodes" section separate from
   "New nodes".

### 6.5 Edges and provenance

Every event carries a source event; the mapper builds edges from the source chain:

```
for each staged entity e:
  parent = staged[e.sourceEventId] ?? targetNode
  edge = { from: parent.nodeId, to: e.nodeId, kind: edgeKindFor(parent.kind, e.kind, e.sfType),
           confidence: e.confidence,
           provenance: { tool:'spiderfoot', run_id, module: e.module, sf_event_type: e.type,
                         observed_at: e.generatedAt, raw_key: e.rawS3Key } }
```

Cycle safety: if the source chain forms a cycle (possible with mutual references), the mapper keeps
the first edge and drops repeats — edges are a set keyed by `(from,to,kind)`.

### 6.6 What NEXUS must never assert

- That two accounts with the same handle belong to the same person. Cross-platform identity edges
  are `same_as` with confidence ≤ 0.9 and a "needs verification" chip (mirrors
  `11_GITHUB.md` §7.3 and `13_SHERLOCK.md` §4).
- That a `HUMAN_NAME` event identifies a real individual — those arrive with confidence 0.4 and the
  label "name string observed", not "person identified".
- That a `MALICIOUS_*` verdict is true; it is recorded as *"flagged by {source}"* with the source
  named.

### 6.7 Correlations → clusters

When `supports.correlations` is true, each correlation record becomes a **cluster group**
(`15_GROUPS`/`06_NODE_SYSTEM.md` group entity), not a node:

```ts
interface CorrelationCluster {
  id: string;                     // corr:{runId}:{correlationId}
  title: string;                  // the correlation's own headline, verbatim
  ruleName: string | null;
  risk: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  memberEntityKeys: string[];
  rationale: string | null;       // instance-provided description, verbatim, sanitized
}
```

Rendering: a group frame around the member nodes, titled with the correlation headline and a risk
chip colored from tokens (`--risk-info/low/medium/high`). If members are not all imported, the
group shows "8 of 23 members imported" with an expand action. Correlations with a single member are
rendered as a badge on that node instead of a group (avoids frame noise).

---

## 7. Volume control

A single scan can emit tens of thousands of events. The canvas budget is 5,000 nodes total (N1), so
**an unfiltered import is never allowed**.

### 7.1 Staging

All events land in Postgres first, never in the Y.Doc:

```sql
CREATE TABLE sf_staged_entity (
  run_id      uuid NOT NULL REFERENCES integration_runs(id) ON DELETE CASCADE,
  entity_key  text NOT NULL,
  kind        text NOT NULL,
  family      text NOT NULL,
  label       text NOT NULL,
  data        jsonb NOT NULL,
  confidence  real NOT NULL,
  hit_count   int NOT NULL DEFAULT 1,
  modules     text[] NOT NULL DEFAULT '{}',
  source_keys text[] NOT NULL DEFAULT '{}',
  first_seen  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL,
  imported    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, entity_key)
);
CREATE INDEX sf_staged_family_idx ON sf_staged_entity(run_id, family, confidence DESC);
```

Staging is cheap, queryable, and lets the user browse 38,204 results in a table while the canvas
holds 200 nodes.

### 7.2 Thresholds

```
IMPORT_SOFT_LIMIT     = 200     // auto-selected in the proposal
IMPORT_HARD_LIMIT     = 2_000   // per import action; above this the Import button is disabled
FAMILY_EXPAND_LIMIT   = 50      // per family, per import
SUMMARY_THRESHOLD     = 25      // a family with more than this collapses to a summary node
BOARD_CEILING         = 5_000   // N1; import is blocked when board + selection would exceed
```

### 7.3 Default selection algorithm

```
select(staged):
  1. always: the target node itself + all entities with hops == 1 and confidence >= 0.7
  2. then, per family, take top-K by score until IMPORT_SOFT_LIMIT is reached:
        score = confidence * 0.6
              + normalized(hit_count) * 0.25          // corroborated across modules
              + (isInCorrelation ? 0.15 : 0)
     K = min(FAMILY_EXPAND_LIMIT, ceil(remaining * familyWeight))
     familyWeight: ip .15 hostname .2 domain .15 email .1 username .1 url .1
                   service .05 certificate .05 vulnerability .05 other .05
  3. every family not fully imported gets one summary node (§7.4)
  4. never select entities with confidence < 0.3 by default (still browsable in the table)
```

The user can change everything; the algorithm only sets the initial checkbox state.

### 7.4 Summary nodes

```ts
interface SummaryNodeData {
  kind: 'summary';
  family: string;              // 'hostname'
  runId: string;
  totalCount: number;          // 4,812
  importedCount: number;       // 50
  topExamples: string[];       // 5 labels
  confidenceHistogram: [number, number, number, number];
  expandQuery: { runId: string; family: string };
}
```

Rendered as a stacked card ("4,812 hostnames · 50 on canvas") with actions: *Open in table*,
*Import 50 more*, *Import all matching a filter*. Expanding is itself a Proposal, so it is undoable.
A summary node is a first-class graph citizen: edges from the target point at it with kind
`summarizes`, so the graph stays connected and exports stay honest.

### 7.5 Incremental import UX

The import sheet is a three-pane review:

- **Left**: family tree with counts and checkboxes (tri-state), plus filters: confidence slider,
  module, hops, "only correlated", text search.
- **Middle**: virtualized table of staged entities (10k+ rows, windowed) with columns
  label / kind / confidence / modules / first seen; row hover previews the raw record.
- **Right**: live preview — "You are adding 214 nodes and 268 edges. Board will hold 1,431 / 5,000
  nodes." with a mini-map thumbnail of where they will be placed.

Placement: imported nodes are laid out in a radial cluster around `originNodeId` (or the viewport
center), family by family, using the auto-layout engine's `radial` mode (`14_VIEWS`/`05_CANVAS_ENGINE.md`
layout section), and the camera animates to fit the new cluster (300 ms, respecting
`prefers-reduced-motion`).

Progressive import while the scan runs: the sheet can be opened mid-scan; it shows what is staged so
far and offers "Import current selection" — subsequent imports from the same run are diffed against
what is already on the board, so nothing is imported twice.

Import is applied as **one** Y.Doc transaction with a single origin tag, which makes the whole
import a single undo step (N3).

### 7.6 Retention

Staged rows live 30 days, then are pruned by a cron job; raw payloads in S3 follow the same
lifecycle. Imported nodes are unaffected. The run record (config, consent, counts, timings, error
codes) is retained indefinitely for audit.

---

## 8. Error copy

| Code | Title | Body | Action |
|---|---|---|---|
| `SF_UNREACHABLE` | "SpiderFoot is not reachable" | "NEXUS could not connect to {baseUrl} (timeout after 10 s). Check the instance is running and the URL is correct." | "Test connection" |
| `SF_AUTH` | "SpiderFoot rejected the credentials" | "The instance answered 401. Update the username/password or header token." | "Open settings" |
| `SF_TLS` | "Certificate not trusted" | "The instance presented a certificate NEXUS does not trust (fingerprint {fp}). Pin this fingerprint if you recognize it." | "Pin fingerprint" |
| `SF_PROBE_FAILED` | "Unsupported SpiderFoot build" | "NEXUS could not identify a usable API on this instance. Version detected: {version ?? 'unknown'}." | "See probe log" |
| `SF_UNSUPPORTED_OPERATION` | "This instance cannot do that" | "The operation '{op}' is not available on this SpiderFoot build." | "See what works" |
| `SF_SCAN_REJECTED` | "Scan was not started" | "The instance refused the scan: {reason}." | "Adjust and retry" |
| `SF_SCAN_FAILED` | "Scan failed" | "The scan stopped after {elapsed}: {reason}. {n} results collected so far can still be imported." | "Import partial results" |
| `SF_TIMEOUT` | "Scan exceeded its time limit" | "The scan hit your {limit} limit and was stopped. {n} results were collected." | "Import partial results" |
| `SF_PARSE` | "Unreadable results" | "NEXUS could not read {n} records from this instance. The raw data was saved." | "Download raw" |
| `SF_LIMIT_EXCEEDED` | "Too many results" | "This scan produced more than {limit} events. NEXUS kept the first {n}; narrow the scan for complete coverage." | "Open results table" |
| `SF_IMAGE_NOT_PINNED` | "Managed SpiderFoot is not configured" | "No pinned image digest is configured, so NEXUS will not start a SpiderFoot container." | "Read setup docs" |
| `SF_CANCELED` | "Scan canceled" | "{n} results collected before cancellation are available." | "Import partial results" |

---

## 9. Testing requirements (feeds `18_TESTING.md`)

1. **Contract suite** run against both clients with recorded fixtures: probe (5 instance shapes,
   including one that answers HTML for every candidate path), scan lifecycle, paging that ignores
   offsets, a truncated JSON export, a CSV-only instance.
2. **Mapping fixtures**: one synthetic event per table row of §6.2 plus 20 unknown types.
3. **Volume test**: 50,000 synthetic events → staging in < 60 s, default selection ≤ 200, canvas
   never exceeds the ceiling, single undo removes the whole import.
4. **Isolation test**: the managed container must fail to reach a host outside the allowlist and the
   run report must show the block count.
5. **Consent test**: starting a scan without a consent record fails with `SF_SCAN_REJECTED` and no
   outbound request is made.
6. **Removal test**: deleting `packages/integrations/spiderfoot/` leaves the build green and
   previously imported nodes intact (architecture test).

---

## Open risks

1. **The HTTP API shape is an assumption.** SpiderFoot's endpoints are not a contract we verified;
   every path in `candidates.ts` may be wrong for a given build. Mitigation: the probe classifies
   before calling, `managed-cli` is the default managed sub-mode, and manual export import is
   always available. If the probe fails on the reference image during CI, the release is blocked.
2. **Upstream is not actively maintained** (0 commits/issues in 90 days per deps.dev, June 2026).
   A CVE in SpiderFoot or its Python dependencies may never be fixed. Mitigation: pinned digest,
   no network except through the allowlisting proxy, gVisor in production, and a documented
   decommission path (tier-1/2 fallbacks in §1.2) that lets us drop the integration without losing
   product capability.
3. **Egress allowlisting can silently break modules** whose data sources we did not enumerate. The
   run report shows blocked-request counts, but a user may misread "no results" as "nothing found".
   Mitigation: the empty state explicitly names blocked hosts and disabled modules.
4. **API-key-dependent modules** live on the user's instance; NEXUS neither stores nor forwards
   those keys. Users may expect NEXUS to configure them. Mitigation: explicit copy in the module
   picker and in the docs.
5. **Correlation semantics vary by build**; risk labels may not exist. We store `risk: 'UNKNOWN'`
   and never color a chip we cannot justify.
6. **Legal exposure**: active scanning against third-party assets is the highest-risk feature in
   NEXUS. The consent record is a control, not a defense. Operators can hard-disable the managed
   mode instance-wide (`SPIDERFOOT_MANAGED_ENABLED=false`), and that switch must be documented in
   `15_SECURITY.md` §9 and `19_DEPLOYMENT.md`.
7. **Estimated duration will be wrong early on** (before local calibration data exists). It is
   always framed as an estimate with a range, never a countdown.
