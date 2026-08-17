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

/** N5: tools only ever execute in the runner service; the API must not be able to spawn. */
describe('architecture', () => {
  it('never imports child_process in apps/api', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const code = readFileSync(file, 'utf8');
      return /child_process|node:child_process/.test(code) || /\bexecSync?\s*\(/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
