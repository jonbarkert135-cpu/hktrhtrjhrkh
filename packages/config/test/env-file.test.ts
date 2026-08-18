import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyEnvFileDefaults,
  envFileCandidates,
  findRepoRoot,
  parseEnvFile,
} from '../src/env-file';

function fakeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'raven-envfile-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('parseEnvFile', () => {
  it('reads plain assignments and ignores blanks and comments', () => {
    expect(parseEnvFile('# c\n\nA=1\nB = two\n')).toEqual({ A: '1', B: 'two' });
  });

  it('supports export prefixes and quoted values that contain #', () => {
    expect(parseEnvFile('export A="v#1"\nB=\'v 2\'\n')).toEqual({ A: 'v#1', B: 'v 2' });
  });

  it('strips inline comments from unquoted values', () => {
    expect(parseEnvFile('A=value   # trailing note\nB=keep#hash\n')).toEqual({
      A: 'value',
      B: 'keep#hash',
    });
  });

  it('skips malformed lines', () => {
    expect(parseEnvFile('not an assignment\n1BAD=x\nOK=y\n')).toEqual({ OK: 'y' });
  });
});

describe('findRepoRoot', () => {
  it('walks up to the workspace root', () => {
    const root = fakeRepo({ 'packages/config/keep.txt': 'x' });
    expect(findRepoRoot(join(root, 'packages', 'config'))).toBe(root);
  });

  it('returns undefined outside a workspace', () => {
    expect(findRepoRoot(mkdtempSync(join(tmpdir(), 'raven-noroot-')))).toBeUndefined();
  });
});

describe('envFileCandidates', () => {
  it('adds the CI file only on CI', () => {
    expect(envFileCandidates('/r', false)).toHaveLength(1);
    expect(envFileCandidates('/r', true)[1]).toBe(join('/r', 'infra', 'ci', '.env.ci'));
  });
});

describe('applyEnvFileDefaults', () => {
  it('fills only unset variables and never overwrites the real environment', () => {
    const root = fakeRepo({ 'infra/ci/.env.ci': 'A=from-file\nB=from-file\n' });
    const env: NodeJS.ProcessEnv = { CI: 'true', A: 'from-runner' };
    expect(applyEnvFileDefaults(env, root)).toEqual(['B']);
    expect(env.A).toBe('from-runner');
    expect(env.B).toBe('from-file');
  });

  it('prefers .env over the CI file', () => {
    const root = fakeRepo({ '.env': 'A=local\n', 'infra/ci/.env.ci': 'A=ci\n' });
    const env: NodeJS.ProcessEnv = { CI: '1' };
    applyEnvFileDefaults(env, root);
    expect(env.A).toBe('local');
  });

  it('ignores the CI file when CI is not set', () => {
    const root = fakeRepo({ 'infra/ci/.env.ci': 'A=ci\n' });
    const env: NodeJS.ProcessEnv = {};
    expect(applyEnvFileDefaults(env, root)).toEqual([]);
    expect(env.A).toBeUndefined();
  });

  it('is a no-op in production', () => {
    const root = fakeRepo({ '.env': 'A=local\n' });
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    expect(applyEnvFileDefaults(env, root)).toEqual([]);
    expect(env.A).toBeUndefined();
  });

  it('is a no-op outside a workspace', () => {
    const outside = mkdtempSync(join(tmpdir(), 'raven-outside-'));
    const env: NodeJS.ProcessEnv = {};
    expect(applyEnvFileDefaults(env, outside)).toEqual([]);
  });
});
