/**
 * The container flag baseline (10_INTEGRATIONS.md §6.3, 15_SECURITY.md §9).
 *
 * This module builds argv and nothing else — no spawning, no I/O — because the flags *are* the
 * security boundary and a pure function is the only way to assert every one of them in a unit test
 * without Docker. `apps/runner/test/sandbox.flags.test.ts` pins each flag; the hostile-image suite
 * proves the kernel actually honours them.
 */

import type { EffectiveLimits, IntegrationManifest } from '@nexus/integrations';
import { IntegrationError } from '@nexus/integrations';

export interface SandboxOptions {
  readonly runId: string;
  readonly orgId: string;
  readonly limits: EffectiveLimits;
  readonly tmpfsMiB: number;
  /** `runsc` (gVisor) in production; `runc` only in dev, and it is a deliberate downgrade. */
  readonly runtime: 'runsc' | 'runc';
  readonly proxyUrl: string;
  readonly network: string;
  readonly seccompProfile: string;
  readonly apparmorProfile: string;
  /** envVar → value. Secret *values* only ever travel here, never in argv (§6.6). */
  readonly env: Readonly<Record<string, string>>;
  readonly secretEnv?: Readonly<Record<string, string>>;
}

export const DEFAULT_SECCOMP_PROFILE = '/etc/raven/seccomp-tool.json';
export const DEFAULT_APPARMOR_PROFILE = 'raven-tool';
export const EGRESS_NETWORK = 'raven-egress';

/** Template roots the command renderer accepts (§4.2). Anything else is unresolvable, not empty. */
const TEMPLATE_ROOTS = new Set(['input', 'workdir', 'runId', 'secretFile']);

/**
 * Renders one argv element. No shell is ever involved, so metacharacters carry no meaning; an
 * array-valued template expands in place into several argv entries.
 */
export function renderTemplate(
  template: string,
  scope: { input: Record<string, unknown>; workdir: string; runId: string; secretDir: string },
): string[] {
  const whole = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(template);
  if (whole !== null) {
    const value = resolvePath(whole[1] ?? '', scope);
    return Array.isArray(value) ? value.map((item) => String(item)) : [String(value)];
  }
  return [
    template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) =>
      String(resolvePath(path, scope)),
    ),
  ];
}

function resolvePath(
  path: string,
  scope: { input: Record<string, unknown>; workdir: string; runId: string; secretDir: string },
): unknown {
  const [root, ...rest] = path.split('.');
  if (root === undefined || !TEMPLATE_ROOTS.has(root)) {
    throw new IntegrationError('MANIFEST_TEMPLATE_UNRESOLVED', {
      why: `The command references "${path}", which is not a supported template root.`,
      detail: { path },
    });
  }
  if (root === 'workdir') return scope.workdir;
  if (root === 'runId') return scope.runId;
  if (root === 'secretFile') {
    const name = rest[0];
    if (name === undefined) {
      throw new IntegrationError('MANIFEST_TEMPLATE_UNRESOLVED', { detail: { path } });
    }
    return `${scope.secretDir}/${name}`;
  }
  let current: unknown = scope.input;
  for (const segment of rest) {
    if (typeof current !== 'object' || current === null) current = undefined;
    else current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined) {
    throw new IntegrationError('MANIFEST_TEMPLATE_UNRESOLVED', {
      why: `The command references "${path}", which this run does not provide.`,
      detail: { path },
    });
  }
  return current;
}

export interface ContainerCommand {
  readonly argv: readonly string[];
  /** Env passed through the container-create API, never through argv (§6.6 point 2). */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * `docker run` argv for a container execution. The Kubernetes Pod spec in 19_DEPLOYMENT.md §4.3 is
 * the 1:1 equivalent of this list; if one changes, both do.
 */
export function buildContainerArgs(
  manifest: IntegrationManifest,
  options: SandboxOptions,
  rendered: readonly string[],
): ContainerCommand {
  if (manifest.execution.kind !== 'container') {
    throw new IntegrationError('INTERNAL', {
      why: 'buildContainerArgs called for a non-container manifest.',
    });
  }
  const execution = manifest.execution;
  const limits = options.limits;
  const env: Record<string, string> = {
    ...execution.env,
    ...options.env,
    HTTP_PROXY: options.proxyUrl,
    HTTPS_PROXY: options.proxyUrl,
    NO_PROXY: '',
  };

  const argv = [
    'run',
    '--rm',
    `--runtime=${options.runtime}`,
    '--user',
    execution.user,
    '--read-only',
    '--tmpfs',
    `${execution.workdir}:rw,noexec,nosuid,nodev,size=${String(options.tmpfsMiB)}m,mode=1777`,
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--mount',
    'type=tmpfs,destination=/run/secrets,tmpfs-size=1m,tmpfs-mode=0400',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--security-opt',
    `seccomp=${options.seccompProfile}`,
    '--security-opt',
    `apparmor=${options.apparmorProfile}`,
    '--pids-limit',
    String(limits.pids),
    '--memory',
    `${String(limits.memoryMiB)}m`,
    '--memory-swap',
    `${String(limits.memoryMiB)}m`,
    '--cpus',
    (limits.cpuMillicores / 1000).toFixed(3),
    '--ulimit',
    'nofile=1024:1024',
    '--ulimit',
    `fsize=${String(limits.maxOutputBytes)}`,
    '--network',
    options.network,
    '--dns',
    '127.0.0.53',
    '--dns-opt',
    'ndots:1',
    '--label',
    `raven.run_id=${options.runId}`,
    '--label',
    `raven.org_id=${options.orgId}`,
    '--stop-timeout',
    '5',
  ];

  for (const key of Object.keys(env)) argv.push('--env', key);
  argv.push(`${execution.image}@${execution.digest}`);
  if (execution.entrypoint !== undefined) argv.push(...execution.entrypoint);
  argv.push(...rendered);

  return { argv, env };
}

/** Renders `execution.command` into argv, validating every template first (§4.2). */
export function renderCommand(
  manifest: IntegrationManifest,
  input: Record<string, unknown>,
  runId: string,
): string[] {
  if (manifest.execution.kind !== 'container') return [];
  const scope = {
    input,
    workdir: manifest.execution.workdir,
    runId,
    secretDir: '/run/secrets',
  };
  return manifest.execution.command.flatMap((element) => renderTemplate(element, scope));
}

/** The label every raven-managed container carries; the reaper sweeps by it. */
export const RUN_LABEL = 'raven.run_id';
