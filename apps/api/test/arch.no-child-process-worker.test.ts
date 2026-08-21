/**
 * N5 across service boundaries (§11 of the phase spec): `apps/runner` is the only package in the
 * repository that may import `child_process` or a container-exec library. The API test next door
 * covers the API alone; this one covers everything else, so a future service cannot quietly add a
 * second way to run code on the host.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const SCANNED = [
  'apps/api/src',
  'apps/worker/src',
  'apps/sync/src',
  'apps/web/src',
  'packages/integrations/src',
  'packages/domain/src',
  'packages/canvas-engine/src',
];

const FORBIDDEN =
  /from\s+'(node:)?child_process'|require\(\s*'(node:)?child_process'\s*\)|from\s+'(dockerode|execa)'/;

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

describe('architecture: only apps/runner spawns processes', () => {
  it.each(SCANNED)('%s has no child_process or container-exec import', (relative) => {
    const offenders = sourceFiles(join(ROOT, relative)).filter((file) =>
      FORBIDDEN.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => file.slice(ROOT.length))).toEqual([]);
  });

  it('apps/runner keeps its spawn surface to one module', () => {
    const offenders = sourceFiles(join(ROOT, 'apps/runner/src'))
      .filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(join(ROOT, 'apps/runner/src').length + 1));
    expect(offenders).toEqual(['executors/container.ts']);
  });
});
