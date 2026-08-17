#!/usr/bin/env node
// Compares bench-results.json against bench/baseline.json (18_TESTING.md §9.2).
// P1 is RECORD-ONLY: it prints the table and always exits 0. Pass --enforce (P2 onwards) to
// fail on a regression > --max-regression (default 5 %) or on an absolute budget breach.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {{ value: number|null, unit: string, budget: number, note?: string }} Metric */

/**
 * @param {Record<string, Metric>} current
 * @param {Record<string, Metric>} baseline
 * @param {number} maxRegression fraction, e.g. 0.05
 * @returns {{ rows: {key:string,current:number|null,baseline:number|null,delta:number|null,verdict:string}[], failures: string[] }}
 */
export function compare(current, baseline, maxRegression = 0.05) {
  const rows = [];
  const failures = [];
  for (const [key, metric] of Object.entries(current)) {
    const before = baseline[key]?.value ?? null;
    const now = metric.value;
    let delta = null;
    let verdict = 'no data';
    if (now === null) {
      verdict = metric.note ? `not measured: ${metric.note}` : 'not measured';
    } else if (metric.budget > 0 && now > metric.budget) {
      verdict = `over budget (${metric.budget} ${metric.unit})`;
      failures.push(
        `${key}: ${now} ${metric.unit} exceeds the budget of ${metric.budget} ${metric.unit}`,
      );
    } else if (before === null || before === 0) {
      verdict = 'new baseline';
    } else {
      delta = (now - before) / before;
      if (delta > maxRegression) {
        verdict = `regression ${(delta * 100).toFixed(1)}%`;
        failures.push(
          `${key}: ${(delta * 100).toFixed(1)}% slower than baseline (limit ${maxRegression * 100}%)`,
        );
      } else {
        verdict = `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
      }
    }
    rows.push({ key, current: now, baseline: before, delta, verdict });
  }
  return { rows, failures };
}

export function toMarkdown(rows) {
  const head = '| metric | current | baseline | verdict |\n|---|---|---|---|';
  const body = rows
    .map((r) => `| ${r.key} | ${r.current ?? '—'} | ${r.baseline ?? '—'} | ${r.verdict} |`)
    .join('\n');
  return `${head}\n${body}`;
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const resultsPath = path.resolve(arg('results', path.join(here, '..', 'bench-results.json')));
  const baselinePath = path.resolve(arg('baseline', path.join(here, 'baseline.json')));
  const enforce = process.argv.includes('--enforce');
  const maxRegression = Number(arg('max-regression', '0.05'));

  const results = readJson(resultsPath, null);
  if (results === null) {
    console.error(`bench/compare.mjs: cannot read ${resultsPath} — run \`pnpm bench\` first`);
    process.exit(1);
  }
  const baseline = readJson(baselinePath, { metrics: {} });
  const { rows, failures } = compare(results.metrics ?? {}, baseline.metrics ?? {}, maxRegression);

  console.log(toMarkdown(rows));
  if (failures.length === 0) {
    console.log('\nbench: no regressions');
    process.exit(0);
  }
  console.log(`\nbench: ${failures.length} problem(s)`);
  for (const f of failures) console.log(`  ${f}`);
  if (!enforce) {
    // RECORD-ONLY until P2 records a real baseline; then CI adds --enforce.
    console.log('\nrecord-only mode (no --enforce): not failing the build');
    process.exit(0);
  }
  process.exit(1);
}
