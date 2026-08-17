// Canvas benchmark harness (18_TESTING.md §9.1). Runs with `node --experimental-strip-types`.
// Writes bench-results.json at the repository root; bench/compare.mjs judges it.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCanvasBenches } from './canvas.bench.ts';

/** The nine metric keys of 18_TESTING.md §9.1, in table order. */
export const METRIC_KEYS = [
  'pan-zoom-5000',
  'pan-zoom-5000-p99',
  'first-interactive-5000',
  'select-all-5000',
  'drag-200-selected',
  'autolayout-1000',
  'route-smart-2000-edges',
  'import-proposal-2000',
  'memory-5000',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/** Absolute budgets from 18_TESTING.md §9.1. */
export const BUDGETS: Record<MetricKey, number> = {
  'pan-zoom-5000': 16.6,
  'pan-zoom-5000-p99': 33,
  'first-interactive-5000': 2500,
  'select-all-5000': 120,
  'drag-200-selected': 16.6,
  'autolayout-1000': 1500,
  'route-smart-2000-edges': 900,
  'import-proposal-2000': 1200,
  'memory-5000': 700,
};

export interface Metric {
  /** Measured value, or null when the capability does not exist yet. Never fabricated. */
  value: number | null;
  unit: 'ms' | 'MB';
  budget: number;
  /** Why the value is null, when it is. */
  note?: string;
}

export interface BenchResults {
  schemaVersion: 1;
  recordedAt: string;
  node: string;
  metrics: Record<MetricKey, Metric>;
}

/** Median of the per-repetition values, the noise-damping rule of 18_TESTING.md §9.1. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** p-th percentile (0–100) with linear interpolation, used for frame-time samples. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loValue = sorted[lo] as number;
  if (lo === hi) return loValue;
  return loValue + (rank - lo) * ((sorted[hi] as number) - loValue);
}

export async function main(): Promise<void> {
  const measured = await runCanvasBenches();
  const results: BenchResults = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    node: process.version,
    metrics: Object.fromEntries(
      METRIC_KEYS.map((key) => [
        key,
        measured[key] ?? {
          value: null,
          unit: key === 'memory-5000' ? 'MB' : 'ms',
          budget: BUDGETS[key],
          note: 'not measurable yet — the capability lands in a later phase',
        },
      ]),
    ) as Record<MetricKey, Metric>,
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = path.join(repoRoot, 'bench-results.json');
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);

  for (const key of METRIC_KEYS) {
    const m = results.metrics[key];
    const shown = m.value === null ? 'null' : `${m.value.toFixed(1)} ${m.unit}`;
    console.log(`${key.padEnd(24)} ${shown.padStart(12)}  (budget ${m.budget} ${m.unit})`);
  }
  console.log(`\nwrote ${out}`);
}

await main();
