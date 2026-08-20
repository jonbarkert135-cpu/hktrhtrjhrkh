/**
 * Secret injection and output scrubbing (10_INTEGRATIONS.md §6.6).
 *
 * Rules that matter more than the code: a secret value never appears in argv, never in a log line,
 * never in `run_log_entries` and never in `integration_runs.input`. The output scrubber is
 * defence in depth, not a guarantee — 15_SECURITY.md §6.4 says so out loud.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SECRET_MOUNT = '/run/secrets';
export const REDACTION_MIN_LENGTH = 8;

export interface SecretResolver {
  /** Resolves a secret by name for a *project* (never for a user, §6.6 point 6). */
  read(name: string, projectId: string): Promise<string | undefined>;
}

export interface MaterializedSecrets {
  /** envVar → value, passed through the container-create API only. */
  readonly env: Readonly<Record<string, string>>;
  /** Host directory mounted at `/run/secrets`, mode 0400, unlinked at run end. */
  readonly dir: string;
  readonly values: readonly string[];
  cleanup(): Promise<void>;
}

export interface MaterializeOptions {
  readonly runId: string;
  readonly projectId: string;
  /** envVar → secret name, from `manifest.execution.secretEnv`. */
  readonly secretEnv: Readonly<Record<string, string>>;
  /** Secret names referenced as `{{secretFile.NAME}}`. */
  readonly secretFiles: readonly string[];
  readonly baseDir: string;
  readonly resolver: SecretResolver;
}

export async function materializeSecrets(
  options: MaterializeOptions,
): Promise<MaterializedSecrets> {
  const dir = join(options.baseDir, options.runId);
  const env: Record<string, string> = {};
  const values: string[] = [];

  for (const [variable, name] of Object.entries(options.secretEnv)) {
    const value = await options.resolver.read(name, options.projectId);
    if (value === undefined) continue;
    env[variable] = value;
    values.push(value);
  }

  if (options.secretFiles.length > 0) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const name of options.secretFiles) {
      const value = await options.resolver.read(name, options.projectId);
      if (value === undefined) continue;
      await writeFile(join(dir, name), value, { mode: 0o400 });
      values.push(value);
    }
  }

  return {
    env,
    dir,
    values,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Replaces every exact occurrence of an injected secret (length ≥ 8) with `«redacted:NAME»`
 * before an artifact, a stdout chunk or an error surface is persisted.
 */
export function scrub(text: string, secrets: Readonly<Record<string, string>>): string {
  let result = text;
  for (const [name, value] of Object.entries(secrets)) {
    if (value.length < REDACTION_MIN_LENGTH) continue;
    result = result.split(value).join(`«redacted:${name}»`);
  }
  return result;
}

/** A pino serializer: env maps are logged with every secret-backed key replaced. */
export function redactEnv(
  env: Readonly<Record<string, string>>,
  secretEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = key in secretEnv ? `«redacted:${secretEnv[key] ?? key}»` : value;
  }
  return redacted;
}
