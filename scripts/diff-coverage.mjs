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
// Mirrors the coverage `exclude` list in packages/config/vitest/base.ts: config files, seeds and
// test helpers are not shipped code, so they cannot carry a coverage obligation.
const NOT_SOURCE = /\.(test|spec|bench)\.(ts|tsx)$|\/test\/|\.d\.ts$|\.config\.(ts|tsx)$|\/seed\//;

// Explicit, reviewable exclusions (see .coverageignore). Vitest applies its own `coverage.exclude`
// lists, but those live in TypeScript configs this script cannot evaluate, so the exclusions are
// restated here in a plain-text file that shows up in every diff.
const ignoreFile = path.join(repoRoot, '.coverageignore');
const ignored = new Set(
  exists(ignoreFile)
    ? readFileSync(ignoreFile, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter((line) => line !== '')
    : [],
);

let changed;
try {
  changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => SOURCE.test(f) && !NOT_SOURCE.test(f) && !ignored.has(f));
} catch (err) {
  console.error(`diff-coverage: cannot diff against "${base}" — ${err.message}`);
  process.exit(1);
}

// A pure reformat adds no logic, so it carries no coverage obligation. Both revisions are run
// through Prettier and compared: if they agree, the only change was formatting. Prettier rewrites
// quote style, trailing commas and line breaks, so a raw whitespace-insensitive compare is not
// enough. Without Prettier on PATH (standalone run) fall back to the whitespace-insensitive
// compare, which is conservative in the direction of keeping the obligation.
changed = changed.filter((file) => {
  const before = show(`${base}:${file}`);
  const after = show(`HEAD:${file}`);
  if (before === null || after === null) return true; // added or deleted: keep the obligation
  const fb = format(before, file);
  const fa = format(after, file);
  if (fb !== null && fa !== null) return fb !== fa;
  return before.replace(/\s+/g, '') !== after.replace(/\s+/g, '');
});

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

/** Prettier-formatted source, or null when Prettier cannot be run or the parse fails. */
function format(source, file) {
  try {
    return execFileSync('pnpm', ['exec', 'prettier', '--stdin-filepath', file], {
      cwd: repoRoot,
      encoding: 'utf8',
      input: source,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** File content at a revision, or null when the path does not exist there. */
function show(rev) {
  try {
    return execFileSync('git', ['show', rev], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return null;
  }
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
