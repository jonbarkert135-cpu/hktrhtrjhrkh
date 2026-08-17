#!/usr/bin/env node
// N10 (00_MASTER.md §4): no TODO/FIXME/XXX markers in shipped source.
// Escape hatch for code that legitimately contains the string (this script, its test, a
// fixture): put `no-todo-check` on the same line. NEXUS-SPEC is never scanned.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, walk, rel, report } from './lib.mjs';

const SCAN = ['apps', 'packages', 'scripts', 'bench', 'e2e', 'infra', '.github'];
const EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.yml',
  '.yaml',
  '.json',
  '.md',
]);
const MARKER = /\b(TODO|FIXME|XXX)\b/;
const ALLOW = 'no-todo-check';
const SELF = path.join(repoRoot, 'scripts', 'check-no-todo.mjs');

const violations = [];
for (const dir of SCAN) {
  for (const file of walk(path.join(repoRoot, dir))) {
    if (file === SELF) continue;
    if (!EXT.has(path.extname(file))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (MARKER.test(line) && !line.includes(ALLOW)) {
        violations.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

report('check-no-todo', violations, 'no TODO/FIXME/XXX markers in shipped source');
