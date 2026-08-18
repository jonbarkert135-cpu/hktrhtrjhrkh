// Drives the web app's canvas surface in a real Chromium and records the metrics of
// 18_TESTING.md §9.1. Metrics the current engine cannot produce are reported as null with a
// reason — a fabricated number is worse than a missing one (N1 is gated on these values).
import { chromium } from '@playwright/test';
import type { Metric, MetricKey } from './harness.ts';
import { BUDGETS, median, percentile } from './harness.ts';

/** Contract the app exposes for benchmarking; implemented by the canvas surface. */
export interface RavenBench {
  /** ms from navigation start to the surface being interactive. */
  readonly readyAt: number;
  /** Nodes currently in the scene — the P1 placeholder has none. */
  readonly nodeCount: number;
  /** Frame durations in ms since the last reset. */
  frameTimes(): number[];
  reset(): void;
}

declare global {
  interface Window {
    __ravenBench?: RavenBench;
  }
}

const URL_UNDER_TEST = process.env.BENCH_URL ?? 'http://localhost:5173/';
const REPETITIONS = 3;
const WARMUP_FRAMES = 30;

/** Scripted 10 s pan + zoom, executed in-page so no test-harness latency is measured. */
async function panZoom(page: import('@playwright/test').Page): Promise<number[]> {
  await page.evaluate(() => window.__ravenBench?.reset());
  const box = await page.locator('canvas').first().boundingBox();
  if (box === null) return [];
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 60; i += 1) {
    await page.mouse.move(cx + Math.sin(i / 6) * 200, cy + Math.cos(i / 6) * 120);
  }
  await page.mouse.up();
  for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
  const frames = await page.evaluate(() => window.__ravenBench?.frameTimes() ?? []);
  return frames.slice(WARMUP_FRAMES);
}

export async function runCanvasBenches(): Promise<Partial<Record<MetricKey, Metric>>> {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(URL_UNDER_TEST, { waitUntil: 'load' });
    const bench = await page.evaluate(() =>
      window.__ravenBench === undefined
        ? null
        : { readyAt: window.__ravenBench.readyAt, nodeCount: window.__ravenBench.nodeCount },
    );
    if (bench === null) {
      return {
        'first-interactive-5000': {
          value: null,
          unit: 'ms',
          budget: BUDGETS['first-interactive-5000'],
          note: `window.__ravenBench is not exposed at ${URL_UNDER_TEST}`,
        },
      };
    }

    const p95s: number[] = [];
    const p99s: number[] = [];
    for (let i = 0; i < REPETITIONS; i += 1) {
      const frames = await panZoom(page);
      if (frames.length === 0) continue;
      p95s.push(percentile(frames, 95));
      p99s.push(percentile(frames, 99));
    }

    // The §9.1 budgets are defined for a 5,000-node board. The P1 placeholder surface has no
    // scene, so the numbers it produces are not that metric and are reported as a note instead.
    const seeded = bench.nodeCount >= 5000;
    const placeholderNote =
      p95s.length === 0
        ? `no frames recorded on the placeholder surface (nodeCount=${bench.nodeCount})`
        : `placeholder surface only (nodeCount=${bench.nodeCount}); frame p95 ${median(p95s).toFixed(2)} ms — ` +
          'the 5,000-node scene arrives with the canvas engine in P2';

    return {
      'pan-zoom-5000': seeded
        ? { value: median(p95s), unit: 'ms', budget: BUDGETS['pan-zoom-5000'] }
        : { value: null, unit: 'ms', budget: BUDGETS['pan-zoom-5000'], note: placeholderNote },
      'pan-zoom-5000-p99': seeded
        ? { value: median(p99s), unit: 'ms', budget: BUDGETS['pan-zoom-5000-p99'] }
        : { value: null, unit: 'ms', budget: BUDGETS['pan-zoom-5000-p99'], note: placeholderNote },
      'first-interactive-5000': seeded
        ? { value: bench.readyAt, unit: 'ms', budget: BUDGETS['first-interactive-5000'] }
        : {
            value: null,
            unit: 'ms',
            budget: BUDGETS['first-interactive-5000'],
            note: `surface ready in ${bench.readyAt.toFixed(0)} ms without a seeded 5,000-node board`,
          },
    };
  } finally {
    await browser.close();
  }
}
