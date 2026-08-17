#!/usr/bin/env node
// 18_TESTING.md §16 hygiene: no skipped and no focused tests reach main.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, walk, rel, report } from './lib.mjs';

const SCAN = ['apps', 'packages', 'bench', 'e2e'];
const TEST_FILE = /\.(test|spec|bench)\.(ts|tsx|js|jsx|mjs)$/;
const PATTERNS = [
  [/\b(it|test|describe)\.skip\b/, 'skipped test'],
  [/\b(it|test|describe)\.only\b/, 'focused test'],
  [/\b(test|describe)\.todo\b/, 'placeholder test'],
  [/\bxit\(|\bxdescribe\(/, 'skipped test'],
];
const SELF = path.join(repoRoot, 'scripts', 'check-skips.mjs');

const violations = [];
for (const dir of SCAN) {
  for (const file of walk(path.join(repoRoot, dir))) {
    if (file === SELF || !TEST_FILE.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [re, what] of PATTERNS) {
        if (re.test(line))
          violations.push(`${rel(file)}:${i + 1}: ${what} — ${line.trim().slice(0, 100)}`);
      }
    });
  }
}

report('check-skips', violations, 'no skipped or focused tests');
