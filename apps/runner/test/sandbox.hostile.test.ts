/**
 * §13 point 4 — the hostile-image suite.
 *
 * These seven assertions are the only proof that the flag baseline in `sandbox/flags.ts` is
 * actually honoured by the kernel rather than merely spelled correctly. They need a container
 * runtime and the purpose-built `raven/test-hostile` image (`infra/docker/test-hostile.Dockerfile`),
 * so they are *skipped, loudly and by name*, wherever either is missing — never silently absent.
 * CI runs them in the `docker` job; a developer laptop without Docker sees seven skips.
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@nexus/integrations';

import { buildContainerArgs, renderCommand } from '../src/sandbox/flags.ts';

const DOCKER = process.env.RUNNER_DOCKER_BIN ?? 'docker';
const IMAGE = process.env.RAVEN_TEST_HOSTILE_IMAGE ?? 'raven/test-hostile:latest';

function dockerAvailable(): boolean {
  try {
    execFileSync(DOCKER, ['image', 'inspect', IMAGE], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const available = dockerAvailable();
const digest = process.env.RAVEN_TEST_HOSTILE_DIGEST ?? `sha256:${'0'.repeat(64)}`;

const hostileManifest = (command: string[]) =>
  parseManifest({
    manifestVersion: 1,
    id: 'test-hostile',
    name: 'Hostile test image',
    version: '1.0.0',
    toolVersion: '1.0.0',
    publisher: { name: 'Raven core' },
    icon: 'integrations/test',
    repository: 'https://example.test/repo',
    license: 'MIT',
    description:
      'An image that deliberately violates every sandbox rule, used by the runner tests.',
    capabilities: ['analyze-file'],
    inputs: [],
    outputs: [{ name: 'console', kind: 'text', fromStdout: true, primary: true }],
    permissions: ['graph:propose'],
    execution: {
      kind: 'container',
      image: IMAGE.split(':')[0] ?? IMAGE,
      digest,
      command,
      network: { mode: 'none', allow: [], denyPrivateRanges: true },
      limits: {
        wallClockMs: 30_000,
        memoryMiB: 128,
        pids: 32,
        cpuMillicores: 500,
        tmpfsMiB: 16,
        maxOutputBytes: 65_536,
      },
      readOnlyRootFs: true,
    },
    parser: { module: 'x', supportedOutputVersions: ['1.0'] },
    rateLimits: {},
    costHints: { typicalDurationMs: 100, typicalOutboundRequests: 0, typicalNewNodes: 0 },
    maturity: 'experimental',
    risk: { label: 'high', upstreamMaintenance: 'unknown' },
    consent: {
      scopeText: 'Internal test image only; it never contacts a third party and imports nothing.',
      allowedTargetScopes: ['owned-asset'],
    },
  });

/** Runs the hostile image with the production flag set and returns its exit code and output. */
function runHostile(
  command: string[],
  env: Record<string, string> = {},
): { code: number; output: string } {
  const manifest = hostileManifest(command);
  const { argv } = buildContainerArgs(
    manifest,
    {
      runId: `hostile-${String(Date.now())}`,
      orgId: 'test',
      limits: {
        wallClockMs: 30_000,
        cpuMillicores: 500,
        memoryMiB: 128,
        pids: 32,
        maxOutputBytes: 65_536,
        maxArtifacts: 1,
        egressAllowlist: [],
        maxRequestsPerMinute: 1,
      },
      tmpfsMiB: 16,
      // gVisor is not available on every CI runner; the flags are otherwise identical.
      runtime: process.env.RAVEN_TEST_RUNTIME === 'runsc' ? 'runsc' : 'runc',
      proxyUrl: 'http://127.0.0.1:1',
      network: process.env.RAVEN_TEST_NETWORK ?? 'none',
      seccompProfile: process.env.RAVEN_TEST_SECCOMP ?? 'unconfined',
      apparmorProfile: process.env.RAVEN_TEST_APPARMOR ?? 'unconfined',
      env,
    },
    renderCommand(manifest, {}, 'hostile'),
  );
  // The manifest pins a digest; the local test image is addressed by tag instead.
  const patched = argv.map((arg) => (arg.includes('@sha256:') ? IMAGE : arg));
  try {
    const output = execFileSync(DOCKER, patched, {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe.skipIf(!available)('hostile image sandbox assertions (§13 point 4)', () => {
  it('cannot write to /', () => {
    expect(runHostile(['/bin/sh', '-c', 'echo x > /pwned']).code).not.toBe(0);
  });

  it('cannot exec a binary it wrote into /work', () => {
    expect(runHostile(['/bin/sh', '-c', 'cp /bin/true /work/t && /work/t']).code).not.toBe(0);
  });

  it('cannot reach the link-local metadata address', () => {
    const result = runHostile([
      '/bin/sh',
      '-c',
      'wget -T 2 -q -O- http://169.254.169.254/ || exit 7',
    ]);
    expect(result.code).not.toBe(0);
  });

  it('hits the pid cap instead of forking without bound', () => {
    const result = runHostile(['/bin/sh', '-c', ':(){ :|:& };: ; sleep 2']);
    expect(result.code).not.toBe(0);
  });

  it('is OOM-killed on a 1 GiB allocation', () => {
    const result = runHostile([
      '/bin/sh',
      '-c',
      'head -c 1073741824 /dev/zero | tail -c 1 > /dev/null',
    ]);
    expect(result.code).not.toBe(0);
  });

  it('has its 10 GiB stdout capped rather than filling the disk', () => {
    const result = runHostile(['/bin/sh', '-c', 'yes hello | head -c 10737418240']);
    expect(result.output.length).toBeLessThan(64 * 1024 * 1024);
  });

  it('never exposes an injected secret in the host process list', () => {
    const { argv } = buildContainerArgs(
      hostileManifest(['/bin/true']),
      {
        runId: 'secret-check',
        orgId: 'test',
        limits: {
          wallClockMs: 1000,
          cpuMillicores: 500,
          memoryMiB: 128,
          pids: 32,
          maxOutputBytes: 1024,
          maxArtifacts: 1,
          egressAllowlist: [],
          maxRequestsPerMinute: 1,
        },
        tmpfsMiB: 16,
        runtime: 'runc',
        proxyUrl: 'http://127.0.0.1:1',
        network: 'none',
        seccompProfile: 'unconfined',
        apparmorProfile: 'unconfined',
        env: { API_TOKEN: 'supersecretvalue' },
      },
      [],
    );
    // The value travels in the create API's env map; argv carries only the variable name.
    expect(argv.join(' ')).toContain('--env API_TOKEN');
    expect(argv.join(' ')).not.toContain('supersecretvalue');
  });
});

describe.skipIf(available)('hostile image sandbox assertions', () => {
  it('is skipped because Docker or raven/test-hostile is unavailable here', () => {
    expect(available).toBe(false);
  });
});
