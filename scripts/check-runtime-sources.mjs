#!/usr/bin/env node
// Gate: the API production image runs its TypeScript sources directly with
// `node --experimental-strip-types` (infra/docker/api.Dockerfile) instead of shipping a bundler.
// Node only *erases* types there, so two things that TypeScript and Vite happily accept would
// crash the container at startup — and no unit test would notice, because Vitest resolves and
// transpiles differently:
//
//   1. Non-erasable syntax (parameter properties, enums, namespaces, decorators) —
//      ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
//   2. Relative import specifiers that do not name a file that exists on disk. Node does not remap
//      `./env.js` to `./env.ts`; it throws ERR_MODULE_NOT_FOUND.
//
// This gate re-checks every file that ends up in the runtime image.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** Everything the api image copies and can therefore load at runtime. */
const RUNTIME_SOURCE_DIRS = [
  'apps/api/src',
  'packages/config/src',
  'packages/db/src',
  'packages/domain/src',
];

const RELATIVE_IMPORT = /(?:^|[^\w$])(?:import|export)[\s\S]{0,200}?from\s*['"](\.[^'"]*)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

function specifiersOf(source) {
  const found = new Set();
  for (const re of [RELATIVE_IMPORT, DYNAMIC_IMPORT]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source)) !== null) if (match[1]) found.add(match[1]);
  }
  return [...found];
}

function main() {
  // stripTypeScriptTypes is behind an experimental flag; the gate output should stay quiet.
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name !== 'ExperimentalWarning') console.warn(warning);
  });

  const errors = [];

  for (const dir of RUNTIME_SOURCE_DIRS) {
    const absolute = join(ROOT, dir);
    for (const file of walk(absolute)) {
      const source = readFileSync(file, 'utf8');
      const shown = relative(ROOT, file);

      try {
        stripTypeScriptTypes(source, { mode: 'strip', filename: file });
      } catch (error) {
        errors.push(`${shown}: not erasable by node --experimental-strip-types — ${error.message}`);
      }

      for (const specifier of specifiersOf(source)) {
        const target = resolve(dirname(file), specifier);
        let exists = false;
        try {
          exists = statSync(target).isFile() || statSync(join(target, 'index.ts')).isFile();
        } catch {
          exists = false;
        }
        if (!exists) {
          errors.push(
            `${shown}: relative import '${specifier}' does not exist on disk — Node resolves ` +
              `specifiers literally, write the real '.ts' path`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error('check-runtime-sources: the api image would fail to start\n');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`check-runtime-sources: ${RUNTIME_SOURCE_DIRS.length} source roots are runtime-safe`);
}

main();
