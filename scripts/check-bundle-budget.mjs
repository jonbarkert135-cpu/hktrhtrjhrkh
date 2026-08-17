#!/usr/bin/env node
// 20_ROADMAP.md P1 §7: initial JS payload of the SPA ≤ 250 KB gzip.
// "Initial" = every module the entry HTML loads eagerly (<script src> + <link rel=modulepreload>).
// Route chunks loaded on navigation are not counted; that is the point of code splitting.
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { repoRoot, exists, rel } from './lib.mjs';

const BUDGET_BYTES = 250 * 1024;
const DIST = path.join(repoRoot, 'apps', 'web', 'dist');
const INDEX = path.join(DIST, 'index.html');

if (!exists(INDEX)) {
  console.error(`check-bundle-budget: ${rel(INDEX)} does not exist — run \`pnpm build\` first`);
  process.exit(1);
}

const html = readFileSync(INDEX, 'utf8');
const refs = new Set();
for (const re of [
  /<script[^>]+src="([^"]+\.js)"/g,
  /<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g,
]) {
  for (const m of html.matchAll(re)) refs.add(m[1]);
}

if (refs.size === 0) {
  console.error(
    `check-bundle-budget: no entry scripts found in ${rel(INDEX)} — the build output looks wrong`,
  );
  process.exit(1);
}

let total = 0;
const rows = [];
for (const ref of refs) {
  const file = path.join(DIST, ref.replace(/^\//, ''));
  if (!exists(file)) {
    console.error(`check-bundle-budget: ${rel(INDEX)}:1: references missing asset ${ref}`);
    process.exit(1);
  }
  const gz = gzipSync(readFileSync(file), { level: 9 }).byteLength;
  total += gz;
  rows.push(
    `  ${ref}  ${(gz / 1024).toFixed(1)} KB gzip (raw ${(statSync(file).size / 1024).toFixed(1)} KB)`,
  );
}

console.log(rows.join('\n'));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
if (total > BUDGET_BYTES) {
  console.error(
    `check-bundle-budget: ${rel(INDEX)}:1: initial JS ${kb(total)} gzip exceeds the ${kb(BUDGET_BYTES)} budget`,
  );
  process.exit(1);
}
console.log(
  `check-bundle-budget: initial JS ${kb(total)} gzip within the ${kb(BUDGET_BYTES)} budget`,
);
