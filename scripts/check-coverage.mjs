#!/usr/bin/env node
// Per-package coverage floors from 18_TESTING.md §14. Reads each package's
// coverage/coverage-summary.json (vitest v8 provider, `json-summary` reporter).
// Packages listed but not yet implemented are skipped; a package that exists and has a
// hard floor but no coverage report is a failure, because that is how a gate silently dies.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, exists, report } from './lib.mjs';

/** [package path, lines %, branches %, hard fail?] */
const TARGETS = [
  ['packages/domain', 90, 85, true],
  ['packages/canvas-engine', 85, 80, true],
  // Layout: lines above the §14 floor, branches below it — see packages/config/vitest/base.ts.
  ['packages/layout', 95, 75, true],
  ['packages/integrations', 85, 75, true],
  ['packages/ui', 70, 60, true],
  ['apps/api', 80, 70, true],
  ['apps/sync', 75, 65, true],
  ['apps/worker', 75, 65, true],
  ['apps/runner', 70, 60, false],
  ['apps/web', 60, 50, false],
];

const violations = [];
for (const [pkg, lines, branches, hard] of TARGETS) {
  const dir = path.join(repoRoot, pkg);
  if (!exists(dir)) continue;
  const summaryPath = path.join(dir, 'coverage', 'coverage-summary.json');
  if (!exists(summaryPath)) {
    const msg = `${pkg}: no coverage/coverage-summary.json (run vitest with --coverage and the json-summary reporter)`;
    if (hard) violations.push(msg);
    else console.warn(`  soft: ${msg}`);
    continue;
  }
  const total = JSON.parse(readFileSync(summaryPath, 'utf8')).total;
  for (const [key, floor] of [
    ['lines', lines],
    ['branches', branches],
  ]) {
    const pct = total?.[key]?.pct ?? 0;
    if (pct < floor) {
      const msg = `${pkg}/coverage/coverage-summary.json: ${key} ${pct}% < ${floor}%`;
      if (hard) violations.push(msg);
      else console.warn(`  soft: ${msg}`);
    }
  }
}

report('check-coverage', violations, 'every package meets its coverage floor');
