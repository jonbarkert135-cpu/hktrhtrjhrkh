/**
 * Node-only companion to `env.ts`. Server processes (API, Prisma client, seed, tooling) read their
 * configuration from `process.env`, but a developer checkout and a CI runner rarely export three
 * dozen variables by hand. This module fills *only the gaps* from dotenv-style files:
 *
 *   1. `<repo>/.env`                — the local developer file (git-ignored)
 *   2. `<repo>/infra/ci/.env.ci`    — committed, dummy-value-only, read when `CI` is set
 *
 * Rules that keep this safe (15_SECURITY.md §2, 19_DEPLOYMENT.md §1.1):
 *   - a variable already present in `process.env` is never overwritten — the real environment wins;
 *   - nothing is read when `NODE_ENV=production`, so a production image cannot be configured by a
 *     file that slipped into the build context;
 *   - the files only ever contain dummy values for ephemeral local/CI services.
 *
 * It is deliberately kept out of `env.ts`: that module is also imported by the browser bundle,
 * which must not pull in `node:fs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadServerEnv, type ServerEnv } from './env.ts';

/** Parse a dotenv-style file. Supports `export ` prefixes, quotes and trailing `# comments`. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] as string;
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length > 1) {
      const end = value.indexOf(quote, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      // strip an inline comment, but only when it is separated from the value by whitespace
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[key] = value;
  }
  return out;
}

/** Walk up from `start` until the workspace root (the directory holding pnpm-workspace.yaml). */
export function findRepoRoot(start: string = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The candidate files, most specific first. */
export function envFileCandidates(root: string, ci: boolean): string[] {
  return ci ? [join(root, '.env'), join(root, 'infra', 'ci', '.env.ci')] : [join(root, '.env')];
}

/**
 * Merge file defaults into `process.env` for keys that are unset. Returns the keys it filled, so
 * callers (and tests) can assert what happened. No-op in production.
 */
export function applyEnvFileDefaults(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string[] {
  if (env.NODE_ENV === 'production') return [];
  const root = findRepoRoot(cwd);
  if (!root) return [];
  const filled: string[] = [];
  for (const file of envFileCandidates(root, Boolean(env.CI))) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(readFileSync(file, 'utf8')))) {
      if (env[key] === undefined) {
        env[key] = value;
        filled.push(key);
      }
    }
  }
  return filled;
}

/** `loadServerEnv()` for Node processes: file defaults first, then the usual strict validation. */
export function loadServerEnvFromProcess(): ServerEnv {
  applyEnvFileDefaults();
  return loadServerEnv(process.env);
}
