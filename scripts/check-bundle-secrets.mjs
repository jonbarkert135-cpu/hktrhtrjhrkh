#!/usr/bin/env node
// 19_DEPLOYMENT.md §1.1: no server secret may reach the browser bundle.
// Two checks over apps/web/dist:
//   1. no server-secret variable NAME appears (a name in the bundle means the value can follow),
//   2. no high-entropy token-shaped literal appears.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, walk, rel, exists, report } from './lib.mjs';

const DIST = path.join(repoRoot, 'apps', 'web', 'dist');
if (!exists(DIST)) {
  console.error(`check-bundle-secrets: ${rel(DIST)} does not exist — run \`pnpm build\` first`);
  process.exit(1);
}

// Server-only names from the env schema. VITE_* names are deliberately absent: they are public.
const SECRET_NAMES = [
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'AUTH_SECRET',
  'SYNC_SHARED_SECRET',
  'RUNNER_SHARED_SECRET',
  'EGRESS_PROXY_URL',
  'AI_API_KEY',
  'AI_BASE_URL',
];

const TEXT = /\.(js|mjs|css|html|json)$/; // .map is build-time only and never served
// Base64/hex-ish runs of 32+ chars: the shape of a leaked key.
const ENTROPY = /['"`]([A-Za-z0-9+/_-]{32,})['"`]/g;

function entropy(s) {
  const freq = new Map();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const violations = [];
for (const file of walk(DIST)) {
  if (!TEXT.test(file)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const name of SECRET_NAMES) {
      if (line.includes(name))
        violations.push(`${rel(file)}:${i + 1}: server secret name "${name}" in the bundle`);
    }
    for (const m of line.matchAll(ENTROPY)) {
      const value = m[1];
      // Mixed alphanumeric, 32+ chars, > 3.8 bits/char: hex and base64 keys match, prose does not.
      if (entropy(value) > 3.8 && /[0-9]/.test(value) && /[A-Za-z]/.test(value)) {
        violations.push(
          `${rel(file)}:${i + 1}: high-entropy literal "${value.slice(0, 12)}…" (${value.length} chars)`,
        );
      }
    }
  });
}

report(
  'check-bundle-secrets',
  violations,
  'no server secret names or key-shaped literals in apps/web/dist',
);
