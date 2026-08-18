# 16 — PERFORMANCE

## Scope

Defines the performance contract for Raven: numeric budgets per surface, the reference hardware
they are measured on, the `bench/` harness and its statistics, the CI regression gate, the catalog
of optimisation techniques with the exact file each is applied in, backend query budgets, a
step-by-step profiling playbook, and the ranked list of known bottlenecks. Non-negotiable N1 from
`00_MASTER.md` §4 (5,000 nodes / 10,000 edges, p95 pan-zoom frame ≤ 16.6 ms, first interactive
≤ 2.5 s) is the anchor; everything here either derives from it or protects it. Rendering mechanics
are specified in `05_CANVAS_ENGINE.md`; schema/index definitions in `08_DATA_MODEL.md`; test
infrastructure in `18_TESTING.md`.

---

## 1. Principles

1. **A budget without a measurement is a wish.** Every number in this document has a benchmark
   that produces it and a CI job that fails when it regresses (`00_MASTER.md` §8.4).
2. **Optimise the frame, not the function.** Work is judged by its contribution to p95 frame time
   and interaction latency, not by microbenchmarks in isolation.
3. **Bound the work by what is visible, not by what exists.** Every hot path must be O(visible)
   or O(changed). Any O(total nodes) work in a per-frame path is a defect regardless of its
   current speed.
4. **Degrade visibly and deliberately.** When a budget cannot be met (huge board, weak device), the
   product drops fidelity in a defined order (§9) and tells the user; it never silently stutters.
5. **Regression is the enemy, not absolute speed.** The gate is ±5% against the previous tag; a
   feature that costs 4% three times has cost 12%.

---

## 2. Reference hardware and environments

Budgets are meaningless without a machine. Three profiles are defined; **P-REF is the contract**.

| Profile   | Machine                                                                                                            | CPU throttle | Viewport / DPR  | Role                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P-REF** | 2020-class laptop: 4-core x86-64 @ ~2.6 GHz base, 16 GB RAM, integrated GPU, Chrome stable, Linux                  | none         | 1440×900, DPR 2 | **The N1 contract machine.** All budgets in §3 are P-REF numbers                                                                                                       |
| **P-CI**  | GitHub Actions `ubuntu-latest` 4-vCPU runner, headless Chrome, `--disable-gpu` unless the software-GL lane is used | none         | 1440×900, DPR 1 | Where the gate runs. CI is noisier and ~1.6× slower than P-REF for canvas work; the gate is therefore **relative** (§4.5), and absolute assertions use the P-CI column |
| **P-LOW** | 4× CPU throttle in CDP (`Emulation.setCPUThrottlingRate: 4`), 1366×768, DPR 1                                      | 4×           | —               | Degradation profile: verifies the product remains _usable_ (not 60 fps) and that fallbacks in §9 engage                                                                |
| **P-4K**  | P-REF at 3840×2160, DPR 2                                                                                          | none         | —               | Stresses DOM overlay budget and fill rate (`05_CANVAS_ENGINE.md` §6.10, risk R1)                                                                                       |

Every benchmark result records `{ profile, commit, node/chrome versions, cpuModel, cores, dpr,
viewport }` in its JSON output so historical comparisons are never made across profiles.

**CI stability requirements** (without these the 5% gate produces false failures):

- `bench` jobs run on a dedicated runner label, one job per runner, no parallel test jobs.
- 3 warmup iterations discarded, then 11 measured repeats; the **median of per-run p95** is the
  reported statistic (median-of-p95 is far more stable on noisy runners than a single p95).
- The gate compares against a baseline stored per git tag in `bench/baselines/<profile>.json`,
  refreshed only by an explicit `chore(bench): rebaseline` PR that states the cause.
- If run-to-run relative standard deviation of the reported statistic exceeds 8%, the job reports
  `unstable` and retries once before failing.

---

## 3. Budgets

### 3.1 Canvas surface (the board) — the N1 contract

| Metric                                        | Scenario                                  | P-REF budget                                 | P-CI budget | Hard fail                          |
| --------------------------------------------- | ----------------------------------------- | -------------------------------------------- | ----------- | ---------------------------------- |
| Frame time p50                                | pan, 5,000 nodes / 10,000 edges, zoom 0.8 | ≤ 8.0 ms                                     | ≤ 12.0 ms   | —                                  |
| Frame time **p95**                            | same                                      | **≤ 16.6 ms**                                | ≤ 26 ms     | > 16.6 ms P-REF                    |
| Frame time p99                                | same                                      | ≤ 24 ms                                      | ≤ 40 ms     | > 33 ms P-REF (two dropped frames) |
| Frame time p95                                | pinch-zoom sweep 0.05 → 2.0               | ≤ 16.6 ms                                    | ≤ 26 ms     | —                                  |
| Frame time p95                                | drag 500 selected nodes                   | ≤ 16.6 ms                                    | ≤ 28 ms     | —                                  |
| Frame time p95                                | marquee across 5,000 nodes                | ≤ 12 ms                                      | ≤ 20 ms     | —                                  |
| Long tasks > 50 ms during any canvas scenario | —                                         | **0**                                        | 0           | any                                |
| Engine `setScene` (5,000 nodes)               | board open                                | ≤ 120 ms, non-blocking beyond 16 ms chunks   | ≤ 200 ms    | > 250 ms                           |
| Spatial `queryRect` (viewport, 5k nodes)      | —                                         | ≤ 0.25 ms                                    | ≤ 0.4 ms    | —                                  |
| `hitTest`                                     | —                                         | ≤ 0.08 ms                                    | ≤ 0.15 ms   | —                                  |
| Overlay reconcile (mount ≤ 40 cards)          | —                                         | ≤ 6 ms                                       | ≤ 10 ms     | —                                  |
| Heap growth over 600 pan frames               | —                                         | ≤ 2 MB                                       | ≤ 3 MB      | > 5 MB                             |
| Steady-state JS heap, 5k/10k board            | after open + 60 s idle                    | ≤ 320 MB                                     | ≤ 380 MB    | > 450 MB                           |
| GPU/canvas memory (bitmap caches)             | —                                         | ≤ 90 MB (12 glyph + 64 thumbnail + canvases) | same        | > 140 MB                           |

### 3.2 Application load

| Metric                                               | Budget (P-REF, warm cache)                            | Budget (cold, simulated Fast 3G + 4× CPU) |
| ---------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Initial JS transferred (app shell route)             | ≤ 190 KB gzip                                         | same                                      |
| Initial CSS                                          | ≤ 28 KB gzip                                          | same                                      |
| Total transferred to first interactive board         | ≤ 420 KB gzip                                         | same                                      |
| FCP                                                  | ≤ 1.0 s                                               | ≤ 2.6 s                                   |
| **TTI / first interactive board (N1)**               | **≤ 2.5 s**                                           | ≤ 6.0 s (degraded, documented)            |
| Board open from IndexedDB (5k nodes, already cached) | ≤ 900 ms to first paint, ≤ 1.6 s to fully interactive | —                                         |
| CLS on the app shell                                 | ≤ 0.02                                                | ≤ 0.05                                    |
| Main-thread blocking time during load                | ≤ 400 ms total                                        | ≤ 1,200 ms                                |

Route-level bundle budgets (gzip, enforced by `size-limit` in CI, `bench/size.config.ts`):

| Chunk                                          | Budget           | Contents                                                 |
| ---------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `app-shell`                                    | 190 KB           | React 19, router, tokens, layout chrome, auth            |
| `canvas`                                       | 120 KB           | `@nexus/canvas-engine` + overlay host + node card shells |
| `editor`                                       | 90 KB            | rich-text editor, loaded on first `edit-text`            |
| `views-graph`                                  | 70 KB            | force graph view (P14)                                   |
| `views-timeline` / `views-table` / `views-map` | 45 / 40 / 110 KB | lazy per view                                            |
| `integrations-ui`                              | 80 KB            | run panel, proposal diff UI                              |
| `ai`                                           | 55 KB            | AI panel + proposal review                               |
| `export-report`                                | 130 KB           | PDF/report generation, loaded on demand                  |
| vendor `yjs+hocuspocus`                        | 95 KB            | part of `app-shell` (needed immediately)                 |

### 3.3 Interaction latency (input → visible response)

| Interaction                                   | Budget p95                   | Notes                                   |
| --------------------------------------------- | ---------------------------- | --------------------------------------- |
| Hover highlight                               | ≤ 32 ms (2 frames)           | interaction layer only                  |
| Click select                                  | ≤ 50 ms                      | includes intent → Y.Doc → patch → paint |
| Drag start (threshold crossed → node follows) | ≤ 50 ms                      |                                         |
| Drag update                                   | ≤ 16.6 ms                    | must be one frame                       |
| Zoom step                                     | ≤ 33 ms                      |                                         |
| Node create from paste (single URL)           | ≤ 120 ms to placeholder node | unfurl completes asynchronously         |
| Open inspector panel                          | ≤ 100 ms                     |                                         |
| `Ctrl+K` palette open + first results         | ≤ 120 ms                     | index is pre-built (§5.16)              |
| In-board search keystroke → results           | ≤ 80 ms                      | worker-backed                           |
| Global search keystroke → results             | ≤ 350 ms p95                 | server round trip, §6                   |
| Undo of a 200-node import                     | ≤ 250 ms                     |                                         |
| Context menu open                             | ≤ 60 ms                      |                                         |

### 3.4 Sync and persistence

| Metric                                                   | Budget                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| Local durability of a mutation (y-indexeddb write acked) | ≤ 100 ms p95 (N2)                                            |
| Server ack of a mutation (Hocuspocus)                    | ≤ 2,000 ms p95 (N2), ≤ 400 ms p50 on a local network         |
| Awareness (cursor) propagation                           | ≤ 150 ms p95                                                 |
| Y.Doc update payload for a single node move              | ≤ 200 B                                                      |
| Board binary snapshot, 5k/10k                            | ≤ 9 MB; if exceeded, compaction runs (`08_DATA_MODEL.md` §9) |
| IndexedDB write batch flush interval                     | 120 ms (§5.12)                                               |

### 3.5 Backend

See §6 for the full table; headline budgets: tRPC p95 ≤ 150 ms for reads, ≤ 300 ms for writes,
Postgres p95 ≤ 25 ms per query, no endpoint issuing more than 4 queries per request.

---

## 4. The benchmark harness

> **Implementation note (P2).** The harness now has two halves. `bench/engine.bench.ts` drives the
> real engine loop in Node against the recording target and produces measured numbers for
> `pan-zoom-5000`, `pan-zoom-5000-p99`, `first-interactive-5000`, `select-all-5000` and
> `drag-200-selected` (plus a hit-test p95 note); `bench/canvas.bench.ts` still drives a real
> Chromium and its values override the headless ones when a dev server is reachable, because only
> the browser run includes rasterization, DOM layout and memory. Scenes come from `bench/scenes.ts`
> (`makeBoard`, fixed seeds). `pnpm bench` accepts `BENCH_SKIP_BROWSER=1` for the headless half
> alone. `bench/compare.mjs` runs with `--enforce` from P2: absolute N1 budgets gate immediately,
> while the 5 % delta gate starts once a baseline recorded **on a CI runner** exists — comparing a CI
> run against a developer machine would fail for hardware reasons, not for regressions.

### 4.1 Layout

```text
bench/
├─ package.json                  scripts: bench:canvas, bench:api, bench:size, bench:all
├─ harness/
│  ├─ runner.ts                  orchestrates scenarios, warmup, repeats, stats, JSON output
│  ├─ browser.ts                 Playwright + CDP session, tracing, CPU throttling, DPR control
│  ├─ frames.ts                  frame capture via CDP + engine metrics reconciliation (§4.3)
│  ├─ stats.ts                   p50/p95/p99, MAD, relative stdev, median-of-p95
│  ├─ profiles.ts                P-REF / P-CI / P-LOW / P-4K definitions (§2)
│  ├─ fixtures.ts                deterministic scene generators (seeded PRNG)
│  └─ report.ts                  markdown + JSON report, PR comment formatter
├─ scenarios/
│  ├─ canvas.pan.bench.ts        S1
│  ├─ canvas.zoom.bench.ts       S2
│  ├─ canvas.dragmulti.bench.ts  S3
│  ├─ edges.reroute.bench.ts     S4
│  ├─ paste.urls.bench.ts        S5
│  ├─ board.open.bench.ts        S6
│  ├─ search.bench.ts            S7
│  ├─ spatial.bench.ts           S8 (in-process, no browser)
│  ├─ alloc.bench.ts             S9 (in-process, --expose-gc)
│  └─ api.k6/*.js                S10 backend load scenarios
├─ fixtures/
│  ├─ board-5k.json              5,000 nodes / 10,000 edges, seed 1337, committed
│  ├─ board-1k.json              smoke size for PR-time runs
│  └─ urls-200.txt               paste corpus
├─ baselines/
│  ├─ P-CI.json                  gate baseline (committed, updated by rebaseline PRs)
│  └─ P-REF.json                 informational, updated from the nightly self-hosted run
└─ README.md
```

### 4.2 Scenarios

| Id      | Name             | Setup                                              | Actions                                                                                            | Reported metrics                                                                                                                                 |
| ------- | ---------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S1**  | 5k nodes pan     | `board-5k.json`, zoom 0.8, viewport centred        | 600 synthetic pan frames along a deterministic Lissajous path covering ~40% of scene bounds        | frame p50/p95/p99, long tasks, dirty-rect count, heap delta                                                                                      |
| **S2**  | zoom sweep       | same                                               | 240 frames: zoom 0.05 → 2.0 → 0.05, anchored at viewport centre; crosses every LOD threshold twice | frame p95 per LOD band, LOD switch count (must be ≤ 8 = 4 thresholds × 2, proving hysteresis works)                                              |
| **S3**  | drag 500 nodes   | same, 500 nodes selected via marquee               | 300 drag frames, 600 world px path                                                                 | frame p95, index update time, intents/frame, route invalidations                                                                                 |
| **S4**  | 10k edge reroute | `board-5k.json` with all edges set to `orthogonal` | move one hub node with degree 40, then drag 500 nodes and release                                  | worker route batch wall time, time to all-routes-fresh after `pointerup` (budget ≤ 900 ms P-REF), frames dropped during the batch (budget 0)     |
| **S5**  | paste 200 URLs   | empty board                                        | paste `urls-200.txt`                                                                               | time to 200 placeholder nodes (≤ 900 ms), main-thread longest task (≤ 50 ms), time to all unfurled (informational — network bound, mocked in CI) |
| **S6**  | board open       | cold IndexedDB, then warm                          | navigate to board with 5k nodes                                                                    | TTI, `setScene` time, first paint, index build time, memory after settle                                                                         |
| **S7**  | search           | `board-5k.json`                                    | 20 keystrokes into in-board search; 10 into global search (mocked API latency 40 ms)               | keystroke → results p95, index build time                                                                                                        |
| **S8**  | spatial index    | in-process, no browser                             | build 5k, 100k `queryRect`, 100k `queryPoint`, 50k `update`                                        | ops/s, ns/op, `maxBucket`, memory; also runs the R-tree reference for comparison (`05_CANVAS_ENGINE.md` §6.2)                                    |
| **S9**  | allocation       | in-process, `--expose-gc`                          | 1,000 simulated frames through the FSM + query paths                                               | heap growth (≤ 256 KB), GC count                                                                                                                 |
| **S10** | API load         | k6 against a seeded API                            | board read, node search, run history, projection write                                             | RPS at p95 budget, error rate, DB p95                                                                                                            |

### 4.3 How frames are measured

Two independent sources, reconciled — because each alone lies:

1. **Engine metrics** (`engine.metrics()`, `05_CANVAS_ENGINE.md` §6.7): the engine's own
   `clock.now()` delta around its frame function. Precise about _engine_ cost, blind to browser
   work (style, layout, paint, composite) and to time spent outside the engine.
2. **CDP tracing**: `Tracing.start` with categories `devtools.timeline`, `blink.user_timing`,
   `disabled-by-default-devtools.timeline.frame`. From the trace we extract per-frame
   `BeginFrame → DrawFrame` durations, `Long Task` events, style/layout/paint/composite breakdown,
   and GC events.

Reported frame time = the **CDP frame duration**; the engine metric is reported alongside as
`engineMs` so a regression can immediately be attributed to engine work vs browser work. If the
two diverge by more than 40% the scenario reports `attribution-mismatch`, which is itself a signal
(usually: DOM overlay writes leaked into a gesture, violating invariant I2).

Synthetic input is driven through CDP `Input.dispatchMouseEvent` at a fixed 60 Hz cadence with
deterministic coordinates — never `page.mouse.move` with default timing, which is not frame-locked.

### 4.4 Statistical method

- Warmup: 3 runs discarded (JIT, cache warm, font load).
- Measured: 11 runs. Within a run, all frames after the first 10 contribute to the distribution.
- Per-run statistics: p50, p95, p99 computed by linear interpolation on the sorted sample.
- Reported statistic: **median across the 11 runs of that run's p95**. Also reported: MAD and
  relative standard deviation for stability triage.
- Sample size sanity: a scenario must produce ≥ 200 frames per run or it is reported invalid.
- Outlier policy: **no outlier removal.** A 300 ms frame is a user-visible stutter and must count.

### 4.5 CI regression gate

```text
for each metric M in gated_metrics:
   base = baselines/P-CI.json[scenario][M]
   cur  = current run value
   if cur > base * 1.05 and cur - base > noiseFloor(M):   FAIL
   if cur > absoluteBudget(M, 'P-CI'):                    FAIL
   if cur < base * 0.90:                                  WARN "improvement — consider rebaseline"
```

- `noiseFloor` prevents a 0.4 ms → 0.43 ms "regression" from failing the build: 0.5 ms for frame
  metrics, 5 KB for bundle sizes, 20 ms for load metrics.
- **Gated metrics:** S1/S2/S3 frame p95, S4 time-to-fresh, S6 TTI and `setScene`, S8 ns/op for
  `queryRect`/`update`, S9 heap growth, all `size-limit` chunk budgets.
- **PR-time (fast) lane:** S1 and S3 on `board-1k`, plus `size-limit`. ~3 minutes.
- **Merge-to-main lane:** all scenarios on `board-5k`, P-CI. ~14 minutes.
- **Nightly lane:** full suite on P-REF (self-hosted) + P-LOW + P-4K, results posted to the
  performance dashboard and to `baselines/P-REF.json`.
- The bot posts a table to the PR: metric, baseline, current, delta%, verdict. A phase cannot pass
  its quality gate without this table in the PR body (`00_MASTER.md` §8.4).

---

## 5. Technique catalog — with the exact place each is applied

Each entry: the technique, where it lives, the number it buys, and the condition under which it
would be wrong to use.

### 5.1 Viewport culling

_Where:_ `packages/canvas-engine/src/render/renderer.ts` via `spatial/queries.ts:inRect`, with the
margin ring from `05_CANVAS_ENGINE.md` §6.10.
_Effect:_ scene-canvas cost becomes O(visible) — 5,000 nodes at zoom 0.8 renders ~180.
_Wrong when:_ the cull rect is computed from a stale camera; always compute it in the same frame.

### 5.2 Level of detail

_Where:_ `render/layers/nodes-lod.ts`, thresholds in `05_CANVAS_ENGINE.md` §6.8.
_Effect:_ at zoom < 0.55 the DOM overlay is empty; a 5,000-node overview paints in ~3 ms.
_Wrong when:_ applied without hysteresis — thrashing at a threshold is worse than no LOD.

### 5.3 DOM virtualization / overlay budget

_Where:_ `render/layers/overlay.ts`, slot pool (§6.11 of the engine doc), `MAX_DOM_NODES = 260`.
_Effect:_ the DOM subtree stays under ~5,000 elements irrespective of board size; style recalc per
camera frame stays under 0.5 ms.
_Also applied to:_ the node list panel, search results, run history, and the table view — all use
`@tanstack/react-virtual` with `overscan: 8` (`apps/web/src/components/VirtualList.tsx`).

### 5.4 Spatial indexing

_Where:_ `spatial/grid-index.ts`, two indexes (nodes, routed edges).
_Effect:_ `queryRect` 0.25 ms at 5k; `hitTest` 0.08 ms; without it, hover on a 5k board costs
~1.2 ms per `pointermove`.
_Wrong when:_ density degenerates (engine risk R2); `stats().maxBucket` is asserted in S8.

### 5.5 Batching

- **Frame batching:** one rAF for the entire engine (`render/scheduler.ts`); no component owns its
  own loop.
- **Patch batching:** Yjs observers are collected per transaction and delivered as one
  `ScenePatch` with `op:'bulk'` (`apps/web/src/canvas/useSceneBridge.ts`), so a 200-node import is
  one index pass and one repaint, not 200.
- **Worker batching:** routing requests coalesce per frame into one message
  (`05_CANVAS_ENGINE.md` §8.4).
- **IndexedDB batching:** §5.12.
- **React batching:** React 19 auto-batches; the overlay additionally applies its diff inside a
  single `flushSync`-free update per frame.

### 5.6 Transform-only animation

_Where:_ overlay container (`transform: translate3d(...) scale(...)`), card slots
(`transform` only), all UI chrome motion presets in `packages/ui/src/motion.ts`.
_Rule:_ the only animatable properties in the entire product are `transform`, `opacity`, and
`filter` on ≤ 3 elements at a time. Animating `width/height/top/left/margin` is a lint error
(`packages/config/eslint/no-layout-animation.ts`).
_Effect:_ camera movement produces zero style recalc and zero layout on the overlay.

### 5.7 Offscreen and worker execution

_Where:_ `workers/routing.worker.ts`, `layout.worker.ts`, `index.worker.ts`
(`05_CANVAS_ENGINE.md` §10). Plus `OffscreenCanvas` used as the **glyph bitmap cache surface**
(not as the render target).
_Effect:_ S4 shows 10,000 orthogonal routes computed in ~700 ms wall time with **zero** dropped
frames on the main thread.
_Wrong when:_ the transfer cost exceeds the compute — do not send a worker anything under ~1 ms of
work; the round trip alone is ~0.3 ms.

### 5.8 Memoization strategy — and when memo hurts

Applied:

- `React.memo` on `NodeCard` with a custom comparator keyed on `(id, visualVersion, selected,
hovered, w, h)`. Cards are the only components rendered in bulk, so this is the one place memo
  reliably pays.
- `useMemo` for derived collections above ~50 items (selection-derived toolbars, filtered lists).
- Module-level memo caches (LRU) for pure derivations: text measurement, glyph bitmaps, colour
  parsing, date formatting (`Intl.DateTimeFormat` instances are cached per locale — constructing
  one costs ~40 µs).

**Deliberately not memoized** (memo hurts here):

- Small leaf components (icons, badges, labels): the comparator costs more than the render.
- Anything whose props include a freshly-created object or lambda every render — memo then always
  misses and adds pure overhead. Rule: if a component's props cannot be compared by `Object.is` on
  primitives, do not `React.memo` it; fix the props first.
- Selectors over Zustand state: use `useStore(selector)` with a stable selector reference and
  shallow equality instead of memoizing a derived object.
- The canvas engine contains **no** memoization of query results across frames; the queries are
  cheaper than the invalidation logic would be.

Measurement rule: any new `React.memo`/`useMemo` in a PR that touches a hot path must be justified
with a before/after number from S1 or the React Profiler; otherwise it is removed in review.

### 5.9 Immutable vs mutable data

- **Document (Y.Doc):** CRDT-mutable, observed. Not our choice to make.
- **Scene graph inside the engine:** **mutable**, with explicit dirty flags. Justification:
  producing a new immutable scene per frame at 5,000 nodes allocates ~2 MB/frame and guarantees GC
  pauses. The engine is single-owner and single-threaded, so mutation is safe; correctness is
  protected by the pure-reducer FSM and by structural snapshot tests.
- **React state (Zustand):** **immutable**, shallow-compared. UI state is small and correctness of
  re-render depends on identity.
- **Worker payloads:** typed arrays, transferred (moved), never shared. After a transfer the
  sender's buffer is detached — the protocol wrapper nulls the reference to make use-after-transfer
  a `TypeError` rather than silent corruption.
- Hot-path arrays are **reused, not recreated** (`queryRect(r, out)` fills a caller array).

### 5.10 Event delegation and listener hygiene

- The engine registers exactly **7** listeners on the container (`pointerdown/move/up/cancel`,
  `wheel`, `contextmenu`, `keydown` on document) plus 4 on `window`
  (`blur`, `resize`, `visibilitychange`, `keyup`). Cards register **none** — all card interaction
  is resolved by hit-testing, not by per-card listeners. At 260 mounted cards this is the
  difference between 11 and ~2,600 listeners.
- All listeners are registered with `{ signal: this.abort.signal }`; `dispose()` aborts once
  (`05_CANVAS_ENGINE.md` §11.3). There is no `removeEventListener` call in the engine.
- Panels and lists in `apps/web` use a single delegated `onClick` on the list root with
  `data-id` lookup, not one handler per row.

### 5.11 Passive listeners

- All scroll listeners: `{ passive: true }`.
- `pointermove` on the container: `{ passive: true }` (the engine never calls `preventDefault` on
  move; drag prevention is handled by `touch-action: none` in CSS).
- `wheel` on the canvas container: `{ passive: false }` — it _must_ `preventDefault()` to suppress
  browser page zoom. This is the only non-passive listener in the product, and it is annotated as
  such in code.
- `touch-action: none` on the canvas container, `touch-action: manipulation` on chrome.

### 5.12 Deferred / idle work and debounce-throttle constants

Single source of truth: `packages/config/src/timings.ts` — no magic numbers at call sites.

| Constant                      | Value                     | Applied at                                      |
| ----------------------------- | ------------------------- | ----------------------------------------------- |
| `VIEWPORT_PERSIST_MS`         | 400 (trailing)            | `camera/viewport-store.ts`                      |
| `IDB_FLUSH_MS`                | 120                       | y-indexeddb write batching (§5.13)              |
| `SEARCH_INPUT_DEBOUNCE_MS`    | 120 (local), 220 (global) | search inputs                                   |
| `HOVER_LEAVE_MS`              | 80                        | engine hover debounce                           |
| `RESIZE_OBSERVER_THROTTLE_MS` | 100                       | container resize → camera recompute             |
| `AWARENESS_THROTTLE_MS`       | 100                       | cursor/selection presence broadcast             |
| `AUTOSAVE_INDICATOR_MS`       | 250                       | `Saving…` → `Saved` transition min-visible time |
| `GROUP_BOUNDS_DEBOUNCE`       | gesture end               | group bounds recompute                          |
| `THUMBNAIL_QUEUE_CONCURRENCY` | 3                         | image decode queue                              |
| `ROUTE_BUDGET_MS`             | 8                         | per worker message slice                        |

`requestIdleCallback` (with a `setTimeout(…, 1)` fallback for Safari) is used for, and only for:
warming the overlay slot pool (48 slots), building the `Ctrl+K` command index, pre-generating
thumbnails for nodes just outside the cull ring, compacting the Y.Doc snapshot, and flushing
telemetry. Every idle callback checks `deadline.timeRemaining() > 4` before starting a unit of work
and re-schedules otherwise; every idle task has a `timeout` so it cannot starve indefinitely.

### 5.13 IndexedDB write batching

`y-indexeddb` persists updates as they arrive; under a fast drag that is one write per frame.
`apps/web/src/data/persistence.ts` wraps the provider with a coalescing buffer: updates are
accumulated in memory and merged with `Y.mergeUpdates` every `IDB_FLUSH_MS = 120` or when the
buffer exceeds 256 KB, whichever comes first, then written in a single transaction. On
`visibilitychange → hidden` and `pagehide` the buffer flushes synchronously.

This preserves N2 (durable within 100 ms p95) because the _measured_ metric is the ack of the write
covering a mutation, and 120 ms coalescing with an immediate flush on the first update of an idle
period yields p95 ≈ 70 ms. It reduces IDB transactions during a 300-frame drag from ~300 to ~3.
Blobs (images, files) never go to IndexedDB; they go to OPFS (`00_MASTER.md` §2) with streamed
writes.

### 5.14 Images, decode and thumbnails

- Uploaded/unfurled images produce three derivatives in the worker service
  (`09_BACKEND.md` §7): `thumb` 320×180 WebP q75, `preview` 1280 px long edge WebP q80, `original`.
- The canvas L2 path draws `thumb` only; the DOM card at L3 draws `preview`; `original` opens in
  the lightbox.
- Decode: `createImageBitmap(blob, { resizeWidth: 320, resizeQuality: 'medium' })` — off-main-thread
  decode and downscale in one call. Never `new Image()` + canvas draw for thumbnails.
- `ImageBitmap`s are cached with byte accounting (cap 64 MB) and **must** be `.close()`d on
  eviction (`05_CANVAS_ENGINE.md` §11.2).
- `<img>` elements in cards: `loading="lazy"`, `decoding="async"`, explicit `width`/`height`
  attributes to reserve space (CLS ≤ 0.02), `fetchpriority="low"` outside the viewport centre.
- Concurrency: at most 3 decodes in flight; the rest queue, prioritised by distance from viewport
  centre. Cancelled when the node leaves the cull ring.

### 5.15 Font loading

- Two families, variable, self-hosted, WOFF2, subset to `latin` + `latin-ext` + Cyrillic (the
  client roadmap and users are Russian-speaking): UI sans and mono.
- `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the two weights used above the
  fold; `font-display: swap` for everything else.
- The engine defers its first canvas-text paint until `document.fonts.ready` and re-invalidates on
  `loadingdone` (`05_CANVAS_ENGINE.md` §6.9) — otherwise L2 titles are measured with fallback
  metrics and visibly jump.
- Font subsetting is a build step; total font payload ≤ 120 KB.

### 5.16 Code splitting map and prefetch

Split points (all `React.lazy` + route-level or interaction-level):

| Chunk             | Loaded when                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `canvas`          | board route mount (part of the critical path)                           |
| `editor`          | first `edit-text` entry, **prefetched on first node hover**             |
| `inspector-rich`  | inspector opens for a node kind with a custom editor                    |
| `views-*`         | view switcher click, **prefetched on view-switcher hover**              |
| `integrations-ui` | run panel open, prefetched when the user has ≥ 1 configured integration |
| `ai`              | AI panel open, prefetched on `Ctrl+K` open if AI is enabled             |
| `export-report`   | export dialog open                                                      |
| `map` (tiles lib) | map view only                                                           |
| `admin`           | admin route only                                                        |

Prefetch policy: `<link rel="modulepreload">` injected on **intent** signals (hover for 120 ms,
focus, or palette open) — never eagerly on load, which would defeat the split. A global cap of 2
concurrent prefetches, suppressed entirely when `navigator.connection.saveData` is true or
`effectiveType` is `2g`/`slow-2g`.

Vite config: `manualChunks` pins `react`, `yjs`, `@nexus/canvas-engine` and `@nexus/domain` into
stable vendor chunks so a UI change does not invalidate them in the browser cache.

### 5.17 Rendering-specific micro-techniques (engine)

- One `ctx.font` assignment per frame, not per node (2.1 ms saved per 500 L2 nodes).
- Glyph bitmap cache keyed by `(kind, accent, status, w, h, lod, dpr)`, LRU 256.
- `Path2D` built once per route, dropped 2 s after leaving the cull ring.
- Dirty rectangles with greedy merge, max 8, else full repaint.
- Separate canvases for grid / scene / interaction so hover and marquee never repaint the scene.
- Integer-aligned strokes: `0.5` offsets for 1 px lines at DPR 1 to avoid 2 px blurry lines.
- No shadows in canvas: `ctx.shadowBlur` is 5–20× more expensive than a fill. Elevation is
  expressed with a 1 px border + a pre-baked gradient in the glyph bitmap
  (`04_DESIGN_SYSTEM.md` §6 must not specify canvas shadows).
- `ctx.save()/restore()` avoided in per-node loops (state stack push measured ~90 ns × 500 nodes);
  state is set once per batch instead, and nodes are drawn grouped by style.

---

## 6. Backend performance

### 6.1 Query budgets

| Operation                           | p50   | p95             | Max queries/request | Notes                                             |
| ----------------------------------- | ----- | --------------- | ------------------- | ------------------------------------------------- |
| `board.get` (metadata + ACL)        | 8 ms  | 25 ms           | 2                   | binary snapshot streamed separately               |
| `board.snapshot` (Yjs binary)       | —     | 120 ms for 9 MB | 1                   | streamed, `Content-Encoding: zstd`                |
| `node.search` (FTS in project)      | 20 ms | 90 ms           | 2                   | GIN index, `ts_rank_cd`, LIMIT 50                 |
| `node.semanticSearch` (pgvector)    | 40 ms | 180 ms          | 2                   | HNSW index, `LIMIT 50`                            |
| `graph.neighbors(depth ≤ 3)`        | 15 ms | 60 ms           | 1                   | recursive CTE with a depth guard and `LIMIT 2000` |
| `run.list`                          | 6 ms  | 20 ms           | 2                   | keyset pagination                                 |
| `run.get` + artifacts               | 12 ms | 45 ms           | 3                   | artifacts are presigned URLs, not blobs           |
| Projection write (per board update) | 15 ms | 70 ms           | 1 batched upsert    | `08_DATA_MODEL.md` §6                             |
| Auth session check                  | 2 ms  | 8 ms            | 1                   | cached in Redis, 60 s TTL                         |

Hard rules: **no endpoint issues more than 4 SQL queries**; any query without an index that can
scan more than 1,000 rows fails the `pg_stat_statements` audit in the nightly job; every list
endpoint is keyset-paginated (`WHERE (created_at, id) < ($1,$2) ORDER BY created_at DESC, id DESC
LIMIT $3`) — never `OFFSET` beyond page 2.

### 6.2 N+1 prevention

1. **Structural:** every tRPC resolver that returns a collection loads its relations with a single
   `include`/`in (…)` query. Prisma `findMany` with `include` is allowed; iterating and awaiting
   inside a loop is banned by ESLint rule `no-await-in-loop` (with an allowlist for genuinely
   sequential migration scripts).
2. **DataLoader** (`apps/api/src/loaders/*`) for the graph endpoints where batching cannot be
   expressed as one query: node-by-id, user-by-id, project-by-id. Per-request instances only —
   a process-lifetime DataLoader is a correctness bug.
3. **Detection in CI:** the integration test suite runs with a Prisma middleware that counts
   queries per request; `expect(queryCount).toBeLessThanOrEqual(budget)` per endpoint, budgets in
   `apps/api/test/query-budgets.ts`. A new N+1 fails the build with the exact SQL logged.

### 6.3 Index list to verify against `08_DATA_MODEL.md`

Every index below must exist in the Prisma schema/migrations; `bench/scenarios/api.k6` and the
nightly `EXPLAIN ANALYZE` audit assert index usage (no `Seq Scan` on these paths):

| Table             | Index                                                                        | Serves                               |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------ | --- | --- | ----------- | --- |
| `nodes`           | `(board_id, updated_at DESC)`                                                | board node listing, incremental sync |
| `nodes`           | `(board_id, kind)`                                                           | filtered views, counts               |
| `nodes`           | GIN on `to_tsvector('simple', title                                          |                                      | ' ' |     | body_text)` | FTS |
| `nodes`           | GIN `pg_trgm` on `title`                                                     | fuzzy title search                   |
| `nodes`           | GIN on `payload jsonb_path_ops`                                              | attribute queries on payload         |
| `nodes`           | HNSW on `embedding vector_cosine_ops`                                        | semantic search (phase 11)           |
| `nodes`           | `(project_id, external_key)` UNIQUE partial `WHERE external_key IS NOT NULL` | import dedupe                        |
| `edges`           | `(board_id, from_id)` and `(board_id, to_id)`                                | neighbour traversal both directions  |
| `edges`           | `(board_id, type)`                                                           | typed filters                        |
| `edges`           | UNIQUE `(board_id, from_id, to_id, type)`                                    | duplicate edge prevention            |
| `runs`            | `(project_id, created_at DESC, id DESC)`                                     | keyset pagination                    |
| `runs`            | `(status)` partial `WHERE status IN ('queued','running')`                    | queue dashboards                     |
| `audit_log`       | `(org_id, created_at DESC)` BRIN on `created_at`                             | audit export                         |
| `board_snapshots` | `(board_id, version DESC)`                                                   | snapshot fetch                       |
| `files`           | `(project_id, sha256)`                                                       | dedupe                               |
| `sessions`        | `(user_id)`, `(expires_at)`                                                  | auth, cleanup                        |

Any query in the codebase whose plan is not covered by one of these must ship a new index **and** a
row in this table in the same PR.

### 6.4 Payload sizes, streaming, pagination

| Response                     | Cap                    | Behaviour above the cap                                                                          |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| Any tRPC JSON response       | 512 KB                 | must paginate; enforced by a Fastify `onSend` hook that logs and fails in dev                    |
| Search results               | 50 items               | keyset `nextCursor`                                                                              |
| `graph.neighbors`            | 2,000 nodes            | returns `truncated: true` and the count                                                          |
| Board snapshot               | unbounded but streamed | `Transfer-Encoding: chunked`, zstd; client applies incrementally                                 |
| Export (report/JSON/archive) | unbounded              | generated in the worker service, delivered as a presigned S3 URL — never through the API process |
| Tool run raw output          | 32 MB                  | stored in S3, API returns a presigned URL + a 64 KB head preview                                 |

Compression: zstd level 6 for snapshots, brotli for static assets, gzip for JSON responses > 1 KB.

### 6.5 Caching and hit targets

| Cache                   | Where                                      | TTL      | Target hit rate                       |
| ----------------------- | ------------------------------------------ | -------- | ------------------------------------- |
| Session lookup          | Redis                                      | 60 s     | ≥ 98%                                 |
| Project ACL             | Redis, invalidated on membership change    | 300 s    | ≥ 95%                                 |
| URL unfurl result       | Postgres `unfurls` keyed by normalised URL | 7 days   | ≥ 60%                                 |
| Favicon / OG image      | S3 + CDN                                   | 30 days  | ≥ 90%                                 |
| GitHub API responses    | Redis, honouring ETag + rate-limit headers | per ETag | ≥ 70%                                 |
| Thumbnail               | S3 + CDN, immutable content-hash URLs      | 1 year   | ≥ 95%                                 |
| Postgres shared buffers | —                                          | —        | ≥ 99% block hit rate; alert below 97% |

Client caches: HTTP `Cache-Control: immutable` for hashed assets; tRPC query cache via TanStack
Query with `staleTime` 30 s for lists, 5 min for static registries (node kinds, integration
manifests).

### 6.6 Concurrency and queues

- Fastify: `keepAliveTimeout` 72 s, body limit 8 MB, 512 max concurrent connections per instance.
- Postgres pool: 20 connections per API instance, 10 per worker instance; PgBouncer in transaction
  mode in production.
- BullMQ: per-queue concurrency — `unfurl` 8, `thumbnail` 4, `repo-analysis` 2, `tool-run` 2
  (runner-bound), `ai` 3. Rate limits per integration follow `10_INTEGRATIONS.md` §11.
- Every job has a hard timeout and is idempotent by `jobId` derived from its inputs.

---

## 7. Profiling playbook

A jank report ("the board stutters when I…") is diagnosed in this exact order. Do not skip steps;
most wrong fixes come from guessing at step 1.

**Step 0 — Reproduce with numbers.** Ask for board size and the action. Open the board, press
`Ctrl+Alt+P` for the engine debug overlay (frame p50/p95, node/edge counts, LOD, DOM mounted,
routes pending, index stats). Screenshot it. If p95 is fine here, the problem is not the engine.

**Step 1 — Classify.** Record a 10 s Chrome Performance trace during the action. Look at the
Frames track and answer one question: **is the main thread busy, or is it idle and still slow?**

- Busy main thread → step 2.
- Idle main thread but late frames → GPU/compositor or network. Check the Compositor track, layer
  count (`Layers` panel), and texture memory. Usual cause: too many `will-change` layers or an
  oversized canvas backing store (DPR > 2).

**Step 2 — Attribute the main-thread cost** from the trace bottom-up, in this order:

| Trace signal                               | Likely cause                                                         | Fix location                         |
| ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------ |
| `Recalculate Style` large                  | overlay writing per-card styles during camera movement (violates I2) | `render/layers/overlay.ts`           |
| `Layout` non-zero during pan               | a card is animating a layout property, or `contain` was dropped      | card CSS, `no-layout-animation` lint |
| `Paint`/`Rasterize` large                  | canvas fill area too big (DPR clamp missing), or `shadowBlur` used   | `render/dpr.ts`, layer code          |
| Long `Function Call` inside `engine.frame` | engine work; go to step 3                                            | engine                               |
| GC events every few frames                 | per-frame allocation                                                 | run S9, `memory/pools.ts`            |
| Long tasks outside the engine              | React render storm                                                   | step 4                               |
| `postMessage`/`Deserialize` heavy          | worker payloads not transferred, or too chatty                       | `workers/protocol.ts`                |

**Step 3 — Engine-internal attribution.** Enable `engine.debug.profileLayers = true`, which wraps
each layer in `performance.mark/measure`. The overlay then shows per-layer ms. Typical readings on
a healthy 5k board at zoom 0.8: grid 0.3, edges 2.1, nodes-lod 1.6, interaction 0.4, overlay
reconcile 0 (steady state). Anything 3× above these is the culprit. Then:

- edges high → check `routes.pending` and whether degraded routing is engaged (§8 of the engine
  doc); check edge count in the cull ring — a hub node with degree 800 defeats culling.
- nodes-lod high → check glyph cache hit rate in `engine.debug.caches`; a `visualVersion` bumping
  every frame (host bug) destroys the cache.
- interaction high → snapping candidate count; verify the 400-candidate cap.

**Step 4 — React attribution.** React Profiler, record the action. Sort by "Rendered at least
once". Expected: during pan, **zero** component renders. Any render during pan is a bug — trace it
with `why-did-you-render` (dev-only) and fix the subscription; the usual cause is a Zustand
selector returning a new object, or camera state leaking into React state (it must never; the
camera lives in the engine).

**Step 5 — Data layer.** If the stutter correlates with editing rather than panning: check Yjs
update sizes (`engine.debug.lastPatch`), IndexedDB flush frequency (Application → IndexedDB, or the
`idb-flush` performance marks), and whether a patch is arriving per keystroke rather than batched.

**Step 6 — Backend.** For "loading is slow": Server-Timing headers are emitted by every API route
(`db`, `serialize`, `total`). Then `pg_stat_statements` sorted by `total_exec_time`, then
`EXPLAIN (ANALYZE, BUFFERS)` on the top offender, then check §6.3 for a missing index.

**Step 7 — Write the regression test before the fix.** Add or extend a `bench/` scenario that
reproduces the jank and fails at the current baseline. A performance fix without a scenario is not
accepted (`00_MASTER.md` §8.4, §8.7).

**Step 8 — Verify on P-LOW too.** A fix that works only on fast hardware is half a fix.

---

## 8. Known bottlenecks, ranked

Ranked by expected frequency × severity. Each has an owner document and a defined mitigation.

| #       | Bottleneck                                                                                                                  | Severity                                                              | Mitigation (already specified)                                                                                                                                                                                                                                                            | Residual risk                                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1**  | DOM overlay reconciliation when many cards cross the promotion boundary at once (fast zoom through 0.55, or a jump-to-node) | High: 40 mounts ≈ 6 ms, 200 ≈ 28 ms → dropped frames                  | Slot pool reuse; LOD hysteresis + frozen LOD during camera gestures; promotion capped at **32 mounts per frame**, remainder deferred to the next frame in distance order (`05_CANVAS_ENGINE.md` §6.10)                                                                                    | A jump into a dense region shows glyphs for ~4 frames before full fidelity — accepted, measured in S2                                                      |
| **B2**  | Orthogonal/smart edge rerouting on drag                                                                                     | High: naive implementation = seconds                                  | Deferred obstacle rerouting to gesture end + degraded bezier during drag + worker batching with an 8 ms slice and cancel-supersede (`05_CANVAS_ENGINE.md` §8.2, §8.4)                                                                                                                     | Post-drag reroute of 10k edges takes ~700 ms; during it, routes are visibly stale-dimmed                                                                   |
| **B3**  | Yjs update storm from a large import or a multi-node drag                                                                   | High: one update per node per frame would flood IDB and the WebSocket | One transaction per gesture/import; patch batching; IDB coalescing at 120 ms; awareness throttled at 100 ms                                                                                                                                                                               | A 5,000-node import produces a ~2–4 MB update; it is applied in one transaction and takes ~300 ms — shown with a progress state, not a spinner-free freeze |
| **B4**  | Text at L2 (`ctx.measureText` + `fillText`)                                                                                 | Medium: text is the dominant L2 cost                                  | Single `ctx.font` per frame, measurement LRU (4,000), pre-truncation to 96 chars, binary-search ellipsis                                                                                                                                                                                  | If it regresses, drop titles below zoom 0.47 (engine risk R7)                                                                                              |
| **B5**  | Image decode and thumbnail memory                                                                                           | Medium: unbounded decode = OOM on image-heavy boards                  | 320×180 thumbs, `createImageBitmap` with `resizeWidth`, concurrency 3, 64 MB byte-accounted LRU with mandatory `close()`                                                                                                                                                                  | Forgetting `close()` leaks non-GC memory — covered by the leak test (`05_CANVAS_ENGINE.md` §11.4)                                                          |
| **B6**  | Spatial index degeneracy from clustered imports                                                                             | Medium                                                                | `GRID_CELL = 512` + oversize overflow list + `maxBucket` assertion in S8 + imports must pre-layout                                                                                                                                                                                        | Escape hatch: swap to quadtree behind `SpatialIndex`                                                                                                       |
| **B7**  | React re-render storms from selection changes on large selections                                                           | Medium                                                                | Selection lives in Zustand with a set-identity selector; cards subscribe to `selected: boolean` for their own id only, via a per-id selector; canvas selection rings are drawn on the interaction canvas, so unselecting 500 nodes repaints one cheap layer and re-renders **zero** cards | A card that reads the whole selection set re-renders on every selection change — caught by the "zero renders during pan/select" Profiler assertion         |
| **B8**  | Board open cost: parse snapshot → build scene → build index → build search index                                            | Medium: 5k board ≈ 400 ms if serial on the main thread                | Snapshot applied in one transaction; `setScene` chunked at 16 ms; index build in `index.worker` above 2,000 nodes; search index built on idle after first paint                                                                                                                           | Cold open on P-LOW is ~1.8 s to interactive — within the degraded budget                                                                                   |
| **B9**  | Backend N+1 on graph/neighbour endpoints                                                                                    | Medium                                                                | DataLoader + per-endpoint query budgets asserted in CI (§6.2)                                                                                                                                                                                                                             | Recursive CTE depth > 3 on a hub-heavy graph can still exceed 60 ms; capped at 2,000 rows with `truncated: true`                                           |
| **B10** | Bundle creep from feature phases                                                                                            | Low-medium but cumulative                                             | `size-limit` per chunk in CI with the same 5% gate; split map (§5.16)                                                                                                                                                                                                                     | Third-party additions (map tiles, PDF) are isolated in lazy chunks                                                                                         |
| **B11** | Long tasks from tool-import proposal diffing (200+ entities compared for dedupe)                                            | Low-medium                                                            | Diff runs in `index.worker`; the proposal UI renders a virtualized list                                                                                                                                                                                                                   | A 2,000-entity SpiderFoot import diff takes ~600 ms in the worker — shown with progress                                                                    |
| **B12** | High-DPR fill cost on 4K displays                                                                                           | Low                                                                   | DPR clamped to 2; separate cheap layers; glyph bitmaps cached at the actual DPR                                                                                                                                                                                                           | P-4K nightly lane guards it                                                                                                                                |

---

## 9. Degradation ladder

When the frame budget is missed for 12 consecutive frames, the engine degrades in this fixed order
and surfaces a single non-blocking notice ("Reduced detail — large board"). Each step is reversible
and re-evaluated every 3 s of healthy frames.

1. Freeze LOD at the current level and stop promoting new DOM cards (cap drops to the currently
   mounted set).
2. Force `L2` for all nodes (drop the DOM overlay entirely except a node in `edit-text`).
3. Switch all edges to fast-path bezier rendering; suspend worker rerouting.
4. Force `L1` (no text) and disable snapping guides during drags.
5. Force `L0` and disable the minimap's live redraw (minimap updates at 2 Hz).

`prefers-reduced-motion: reduce` independently disables camera animation, node enter/exit motion
and all UI transitions (N6) — that is an accessibility behaviour, not a degradation step, and is
never auto-reverted.

---

## 10. Observability in production

- **RUM**: Web Vitals (LCP, INP, CLS) plus custom marks — `board.open`, `canvas.frame.p95`
  (sampled 1 in 20 sessions, 240-frame window), `interaction.select`, `interaction.dragStart`,
  `sync.ackLatency`. Sent batched on idle, ≤ 2 KB per batch, no PII, opt-outable.
- **Engine telemetry events**: `overlay-budget-exceeded`, `engine-degraded:<level>`,
  `worker-degraded`, `attribution-mismatch`, `index-maxbucket-high`. Each carries board size and
  device class, never board content.
- **Backend**: OpenTelemetry traces on every request with `Server-Timing` echoed to the client;
  `pg_stat_statements` scraped hourly; per-endpoint p95 dashboards with alerts at 1.5× budget for
  10 minutes.
- **Alerts that page:** API p95 > 2× budget for 10 min; projection lag > 30 s; job queue depth
  > 1,000 for 15 min; Postgres block hit rate < 97%.

---

## Open risks

| #   | Risk                                                                                                                                                                    | Impact                               | Mitigation / trigger                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The P-CI runner is too noisy for a 5% gate on frame metrics despite median-of-p95 and noise floors                                                                      | Flaky builds erode trust in the gate | Stability is measured: if relative stdev > 8% for two weeks, move frame gating to the nightly P-REF lane and keep only bundle-size and in-process (S8/S9) gating on PRs                                                                               |
| R2  | The P-REF machine definition drifts (the "2020-class laptop" of 2026 is not the one N1 was written against)                                                             | Budgets silently loosen or tighten   | The profile pins CPU model, cores, clock and browser version in `bench/harness/profiles.ts`; changing it requires a spec PR that updates this table and re-baselines                                                                                  |
| R3  | 120 ms IndexedDB coalescing could, in a crash within the window, lose up to 120 ms of edits, in tension with N2                                                         | Data loss of a fraction of a gesture | The window is only reached during continuous input; the buffer flushes on the first update after idle, on 256 KB, and on `pagehide`. If the kill-tab test ever loses a committed mutation, drop the window to 40 ms and accept the extra transactions |
| R4  | Degradation ladder step 2 (drop the DOM overlay) is visually dramatic and could be read as a bug                                                                        | Trust                                | The notice text is explicit and links to a "why is this board slow" explainer; the ladder is tested on P-LOW in the nightly lane                                                                                                                      |
| R5  | pgvector HNSW index build time and memory on large projects (> 500k nodes) is not yet measured — outside phase 11 scope                                                 | Unknown backend cost                 | Treated as a phase-11 entry criterion: measure before enabling; fall back to FTS-only search with the semantic toggle disabled per project                                                                                                            |
| R6  | Worker-based routing assumes the routing algorithms in `packages/domain` meet ~0.3 ms/edge; if `07_EDGE_SYSTEM.md` chooses a heavier algorithm, B2's mitigation weakens | Post-drag reroute time balloons      | S4 gates `time-to-all-routes-fresh` at 900 ms; exceeding it forces either algorithm simplification or per-viewport-only rerouting with lazy off-screen routes                                                                                         |
| R7  | Third-party embeds (link preview iframes) are outside our budget and can jank a card                                                                                    | Localised stutter                    | Embeds render only on explicit user action, are `loading="lazy"`, sandboxed, and are capped at 3 live embeds per board; beyond that, static preview images                                                                                            |
| R8  | `INP` (interaction to next paint) is measured on the DOM chrome, but the canvas's real latency is invisible to Web Vitals                                               | Blind spot in RUM                    | Custom `interaction.*` marks (§10) fill the gap; they are the metric of record for canvas latency, not INP                                                                                                                                            |
