#!/usr/bin/env node
// Removes build- and test-time tooling from a production dependency tree.
//
// Why this exists
// ---------------
// `.npmrc` sets `auto-install-peers=true`, which makes pnpm materialise the *optional* peer
// dependencies of our runtime dependencies as real packages. `@prisma/client` peers on the Prisma
// CLI, `better-auth` peers on every adapter it supports, `vitest`/`vite` arrive through those
// chains, and vite ships the `esbuild` Go binary. The result: even
// `pnpm install --prod --filter "@nexus/api..."` produces a tree that contains esbuild, vite,
// vitest, jsdom and React — none of which `node apps/api/src/server.ts` ever loads, all of which
// widen the image attack surface (the esbuild binary alone accounted for 1 CRITICAL + 11 HIGH Go
// stdlib findings in the Trivy gate, see NEXUS-SPEC/15_SECURITY.md §9.4).
//
// pnpm cannot express "install prod deps but not their optional peers" (`auto-install-peers=false`
// is a lockfile-level setting and would invalidate `--frozen-lockfile`), so the prune is done
// afterwards, from an explicit deny list. The list only contains bundlers, test runners and their
// platform binaries: packages that are executables/dev tooling by nature, never imported by
// server code. Anything not on the list is kept.
//
// Usage: node scripts/prune-runtime-store.mjs [--root <dir>] [--dry-run]

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Packages (exact names or scopes) that must never end up in the runtime image. */
const DENY_EXACT = new Set([
  'esbuild',
  'rollup',
  'tsx',
  'vite',
  'vite-node',
  'vitest',
  'jsdom',
  'lightningcss',
  'postcss',
  'terser',
  'typescript',
]);

/** Scopes whose every package is build tooling or a platform binary of the above. */
const DENY_SCOPES = ['@esbuild', '@rollup', '@vitest', '@babel', '@swc'];

/** Name prefixes used by optional platform binaries that do not carry a scope. */
const DENY_PREFIXES = ['lightningcss-', '@napi-rs+lzma-'];

/**
 * Decodes a pnpm virtual-store directory name into the package name it holds.
 * `@esbuild+linux-x64@0.25.12` -> `@esbuild/linux-x64`, `vite@6.4.3(...)` -> `vite`.
 */
export function packageNameOf(storeDirName) {
  // The directory name is `<name>@<version>` with the name's `/` written as `+`, followed by the
  // peer-resolution suffix pnpm appends (`_peer@1.0.0` or `(peer@1.0.0)`), which may itself
  // contain `@` characters — so the version separator is the *first* `@` after the scope.
  const versionAt = storeDirName.startsWith('@')
    ? storeDirName.indexOf('@', 1)
    : storeDirName.indexOf('@');
  const nameWithPlus = versionAt > 0 ? storeDirName.slice(0, versionAt) : storeDirName;
  return nameWithPlus.replace('+', '/');
}

export function isBuildTooling(packageName) {
  if (DENY_EXACT.has(packageName)) return true;
  if (DENY_SCOPES.some((scope) => packageName.startsWith(`${scope}/`))) return true;
  return DENY_PREFIXES.some((prefix) => packageName.startsWith(prefix.replace('+', '/')));
}

function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = resolve(rootIndex === -1 ? process.cwd() : (args[rootIndex + 1] ?? process.cwd()));
  const dryRun = args.includes('--dry-run');
  const store = join(root, 'node_modules', '.pnpm');

  let entries;
  try {
    entries = readdirSync(store);
  } catch {
    console.error(`prune-runtime-store: no virtual store at ${store}`);
    process.exit(1);
  }

  const removed = [];
  for (const entry of entries) {
    const path = join(store, entry);
    if (!statSync(path).isDirectory()) continue;
    const name = packageNameOf(entry);
    if (!isBuildTooling(name)) continue;
    removed.push(entry);
    if (!dryRun) rmSync(path, { recursive: true, force: true });
  }

  removed.sort();
  console.log(
    `prune-runtime-store: ${dryRun ? 'would remove' : 'removed'} ${removed.length} of ${entries.length} store entries`,
  );
  for (const entry of removed) console.log(`  - ${entry}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
