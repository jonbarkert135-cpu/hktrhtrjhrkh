import { describe, expect, it } from 'vitest';
import { parseManifest, type EffectiveLimits } from '@nexus/integrations';

import { buildContainerArgs, renderCommand, renderTemplate } from '../src/sandbox/flags.ts';
import { redactEnv, scrub } from '../src/sandbox/secrets.ts';
import { StreamRingBuffer, artifactKey, collectArtifact } from '../src/artifacts.ts';

const manifest = parseManifest({
  manifestVersion: 1,
  id: 'test-tool',
  name: 'Test tool',
  version: '1.0.0',
  toolVersion: '2.0.0',
  publisher: { name: 'Raven core' },
  icon: 'integrations/test',
  repository: 'https://example.test/repo',
  license: 'MIT',
  description: 'A container manifest used to pin the sandbox flag baseline in tests.',
  capabilities: ['scan-domain'],
  inputs: [{ name: 'target', label: 'Target', type: 'string', from: { source: 'form' } }],
  outputs: [{ name: 'result', kind: 'json', path: '/work/out.json', primary: true }],
  permissions: ['graph:propose', 'net:allowlist', 'secrets:read'],
  execution: {
    kind: 'container',
    image: 'example/tool',
    digest: `sha256:${'a'.repeat(64)}`,
    entrypoint: ['/usr/bin/tool'],
    command: [
      '--target',
      '{{input.target}}',
      '--out',
      '{{workdir}}/out.json',
      '--token',
      '{{secretFile.api}}',
    ],
    env: { HOME: '/work' },
    secretEnv: { API_TOKEN: 'tool.api' },
    network: { mode: 'allowlist', allow: ['api.example.test'], denyPrivateRanges: true },
    limits: {
      wallClockMs: 60_000,
      memoryMiB: 256,
      pids: 64,
      cpuMillicores: 500,
      tmpfsMiB: 32,
      maxOutputBytes: 1024,
    },
    readOnlyRootFs: true,
  },
  parser: { module: 'x', supportedOutputVersions: ['2.0'] },
  rateLimits: {},
  costHints: { typicalDurationMs: 1000, typicalOutboundRequests: 1, typicalNewNodes: 1 },
  maturity: 'experimental',
  risk: { label: 'medium', upstreamMaintenance: 'unknown' },
  consent: {
    scopeText: 'I confirm I am authorized to scan this target and that it is lawful where I am.',
    allowedTargetScopes: ['owned-asset'],
  },
});

const limits: EffectiveLimits = {
  wallClockMs: 60_000,
  cpuMillicores: 500,
  memoryMiB: 256,
  pids: 64,
  maxOutputBytes: 1024,
  maxArtifacts: 4,
  egressAllowlist: ['api.example.test'],
  maxRequestsPerMinute: 120,
};

const sandbox = {
  runId: 'run-1',
  orgId: 'org-1',
  limits,
  tmpfsMiB: 32,
  runtime: 'runsc' as const,
  proxyUrl: 'http://egress:3128',
  network: 'raven-egress',
  seccompProfile: '/etc/raven/seccomp-tool.json',
  apparmorProfile: 'raven-tool',
  env: {},
};

describe('container flag baseline (§6.3)', () => {
  const rendered = renderCommand(manifest, { target: 'example.test' }, 'run-1');
  const { argv, env } = buildContainerArgs(manifest, sandbox, rendered);
  const argline = argv.join(' ');

  it('pins every flag of the baseline', () => {
    expect(argline).toContain('--runtime=runsc');
    expect(argline).toContain('--user 65534:65534');
    expect(argline).toContain('--read-only');
    expect(argline).toContain('/work:rw,noexec,nosuid,nodev,size=32m,mode=1777');
    expect(argline).toContain('--cap-drop ALL');
    expect(argline).toContain('no-new-privileges');
    expect(argline).toContain('seccomp=/etc/raven/seccomp-tool.json');
    expect(argline).toContain('apparmor=raven-tool');
    expect(argline).toContain('--pids-limit 64');
    expect(argline).toContain('--memory 256m --memory-swap 256m');
    expect(argline).toContain('--cpus 0.500');
    expect(argline).toContain('--ulimit fsize=1024');
    expect(argline).toContain('--network raven-egress');
    expect(argline).toContain('--label raven.run_id=run-1');
    expect(argline).toContain('--stop-timeout 5');
    expect(argline).toContain(`example/tool@sha256:${'a'.repeat(64)}`);
  });

  it('routes all egress through the proxy and never through a shell', () => {
    expect(env.HTTP_PROXY).toBe('http://egress:3128');
    expect(env.HTTPS_PROXY).toBe('http://egress:3128');
    expect(env.NO_PROXY).toBe('');
    expect(argv).not.toContain('sh');
    expect(argv).not.toContain('-c');
  });

  it('renders templates as separate argv entries and never inlines a secret value', () => {
    expect(rendered).toEqual([
      '--target',
      'example.test',
      '--out',
      '/work/out.json',
      '--token',
      '/run/secrets/api',
    ]);
    expect(
      renderTemplate('{{input.list}}', {
        input: { list: ['a', 'b'] },
        workdir: '/w',
        runId: 'r',
        secretDir: '/s',
      }),
    ).toEqual(['a', 'b']);
  });

  it('fails closed on an unresolvable template', () => {
    expect(() => renderCommand(manifest, {}, 'run-1')).toThrow(/MANIFEST_TEMPLATE_UNRESOLVED/);
    expect(() =>
      renderTemplate('{{process.env.SECRET}}', {
        input: {},
        workdir: '/w',
        runId: 'r',
        secretDir: '/s',
      }),
    ).toThrow(/MANIFEST_TEMPLATE_UNRESOLVED/);
  });
});

describe('secrets (§6.6)', () => {
  it('scrubs secret values out of anything persisted, and only when long enough to be one', () => {
    expect(scrub('token=supersecretvalue done', { API: 'supersecretvalue' })).toBe(
      'token=«redacted:API» done',
    );
    expect(scrub('n=short', { API: 'short' })).toBe('n=short');
  });

  it('redacts secret-backed env keys in log output', () => {
    expect(redactEnv({ API_TOKEN: 'abcd1234', HOME: '/work' }, { API_TOKEN: 'tool.api' })).toEqual({
      API_TOKEN: '«redacted:tool.api»',
      HOME: '/work',
    });
  });
});

describe('artifacts (§6.8)', () => {
  it('truncates at the smaller cap and marks the ref', async () => {
    const stored: { key: string; bytes: number }[] = [];
    const sink = {
      put: (key: string, body: Uint8Array) => {
        stored.push({ key, bytes: body.byteLength });
        return Promise.resolve();
      },
    };
    const collected = await collectArtifact(sink, new TextEncoder().encode('x'.repeat(100)), {
      orgId: 'org-1',
      runId: 'run-1',
      name: 'result.json',
      kind: 'json',
      maxBytes: 40,
      runBudget: 1000,
      bucket: 'raven',
    });
    expect(collected.ref.truncated).toBe(true);
    expect(collected.ref.bytes).toBe(40);
    expect(stored[0]?.key).toBe(artifactKey('org-1', 'run-1', 'result.json'));
    expect(collected.ref.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps the head and the tail of an oversized stream with an elision marker', () => {
    const buffer = new StreamRingBuffer();
    const chunk = new TextEncoder().encode('a'.repeat(512 * 1024));
    for (let i = 0; i < 8; i += 1) buffer.push(chunk);
    expect(buffer.truncated).toBe(true);
    expect(buffer.text()).toContain('bytes elided');
  });
});
