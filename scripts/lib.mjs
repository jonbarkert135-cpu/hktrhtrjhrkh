// Shared helpers for the CI gate scripts. Node builtins only.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  'RAVEN-SPEC',
  'playwright-report',
  'test-results',
  '.worktrees',
]);

/** Recursively list files under `dir` (absolute paths), skipping generated/vendor trees. */
export function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export const rel = (p) => path.relative(repoRoot, p);

export function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Print the violations and exit 1, or print the ok line and exit 0. */
export function report(name, violations, okMessage) {
  if (violations.length > 0) {
    console.error(`${name}: ${violations.length} violation(s)\n`);
    for (const v of violations) console.error(`  ${v}`);
    console.error('');
    process.exit(1);
  }
  console.log(`${name}: ${okMessage}`);
}
