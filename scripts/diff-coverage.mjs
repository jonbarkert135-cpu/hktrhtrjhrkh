#!/usr/bin/env node
// Diff coverage (18_TESTING.md §14): every changed source file must be ≥ 80 % lines covered.
// Usage: node scripts/diff-coverage.mjs [--base=<ref>] (default: origin/main)
// ponytail: file-level granularity instead of true changed-line granularity — the ceiling is
// that a tiny edit to a big well-covered file passes; upgrade path is parsing `git diff -U0`
// hunks against coverage-final.json line maps when the repo has enough history to need it.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, exists, report } from './lib.mjs';

const FLOOR = 80;
const baseArg = process.argv.find((a) => a.startsWith('--base='));
const base = baseArg ? baseArg.slice('--base='.length) : 'origin/main';
const SOURCE = /^(apps|packages)\/.+\.(ts|tsx)$/;
const NOT_SOURCE = /\.(test|spec|bench)\.(ts|tsx)$|\/test\/|\.d\.ts$/;

let changed;
try {
  changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => SOURCE.test(f) && !NOT_SOURCE.test(f));
} catch (err) {
  console.error(`diff-coverage: cannot diff against "${base}" — ${err.message}`);
  process.exit(1);
}

if (changed.length === 0) {
  console.log('diff-coverage: no changed source files');
  process.exit(0);
}

// Index every available coverage summary by absolute file path.
const byFile = new Map();
for (const pkg of ['packages', 'apps']) {
  const root = path.join(repoRoot, pkg);
  if (!exists(root)) continue;
  for (const name of readdirSafe(root)) {
    const summaryPath = path.join(root, name, 'coverage', 'coverage-summary.json');
    if (!exists(summaryPath)) continue;
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    for (const [file, data] of Object.entries(summary)) {
      if (file === 'total') continue;
      byFile.set(path.resolve(root, name, file), data);
    }
  }
}

const violations = [];
for (const file of changed) {
  const data = byFile.get(path.join(repoRoot, file));
  if (!data) {
    violations.push(
      `${file}:1: changed but has no coverage entry — add a test or exclude it explicitly`,
    );
    continue;
  }
  const pct = data.lines?.pct ?? 0;
  if (pct < FLOOR) violations.push(`${file}:1: lines ${pct}% < ${FLOOR}% on a changed file`);
}

report(
  'diff-coverage',
  violations,
  `all ${changed.length} changed source file(s) ≥ ${FLOOR}% lines`,
);

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
