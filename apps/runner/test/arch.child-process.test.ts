/**
 * N5 as an architecture test: exactly one module in this service may spawn a process, and it is the
 * container executor. If a second one appears, the sandbox has a second, unreviewed door.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('architecture', () => {
  it('spawns processes only from executors/container.ts', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /child_process/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual(['executors/container.ts']);
  });
});
