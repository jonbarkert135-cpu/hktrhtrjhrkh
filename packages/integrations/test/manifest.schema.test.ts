import { describe, expect, it } from 'vitest';
import { builtinEdgeTypes, builtinNodeTypes } from '@nexus/domain';

import { manifest as expandUrl } from '../builtin/manifest.ts';
import { BUILTIN_SOURCES, buildRegistry } from '../src/index.ts';
import { safeParseManifest, migrateManifest, CURRENT_MANIFEST_VERSION } from '../src/manifest.ts';
import { checkManifestConformance } from '../src/testkit/index.ts';

const nodeTypes = new Set(
  builtinNodeTypes()
    .list()
    .map((definition) => definition.type),
);
const edgeTypes = new Set(
  builtinEdgeTypes()
    .list()
    .map((definition) => definition.type),
);

const valid = () => JSON.parse(JSON.stringify(expandUrl)) as Record<string, unknown>;

describe('manifest schema', () => {
  it('accepts every shipped manifest and its conformance rules (§13 point 1)', () => {
    for (const source of BUILTIN_SOURCES) {
      const issues = checkManifestConformance(source.raw, {
        knownNodeTypes: nodeTypes,
        knownEdgeTypes: edgeTypes,
      });
      expect(issues).toEqual([]);
    }
  });

  it('rejects a manifest with more than one primary output', () => {
    const raw = valid();
    raw.outputs = [
      { name: 'a', kind: 'json', primary: true },
      { name: 'b', kind: 'json', primary: true },
    ];
    const parsed = safeParseManifest(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.map((issue) => issue.message)).toContain(
        'exactly one output must be primary',
      );
    }
  });

  it('rejects broad network access without the net:broad permission', () => {
    const raw = valid();
    raw.permissions = ['graph:propose'];
    raw.execution = {
      kind: 'container',
      image: 'example/tool',
      digest: `sha256:${'a'.repeat(64)}`,
      command: ['run'],
      network: { mode: 'broad', allow: [], denyPrivateRanges: true },
      limits: {},
      readOnlyRootFs: true,
    };
    const parsed = safeParseManifest(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.map((i) => i.message)).toContain(
        'network.mode=broad requires permission net:broad',
      );
    }
  });

  it('rejects a container manifest without a pinned digest', () => {
    const raw = valid();
    raw.execution = {
      kind: 'container',
      image: 'example/tool',
      digest: 'latest',
      command: ['run'],
      network: { mode: 'none', allow: [], denyPrivateRanges: true },
      limits: {},
      readOnlyRootFs: true,
    };
    expect(safeParseManifest(raw).ok).toBe(false);
  });

  it('rejects an input field the form could not render, naming the field (§8 edge cases)', () => {
    const raw = valid();
    raw.inputs = [{ name: 'mode', label: 'Mode', type: 'enum', from: { source: 'form' } }];
    const parsed = safeParseManifest(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.some((issue) => issue.message.includes('"mode"'))).toBe(true);
    }
  });

  it('rejects execution.workdirExec, which v1 does not support (§6.3)', () => {
    const raw = valid();
    raw.execution = { ...(raw.execution as Record<string, unknown>), workdirExec: true };
    const parsed = safeParseManifest(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]?.path).toBe('execution.workdirExec');
  });

  it('rejects a pattern that is not RE2-safe', () => {
    const raw = valid();
    raw.inputs = [
      {
        name: 'url',
        label: 'URL',
        type: 'string',
        pattern: '^(?=.*evil).*$',
        from: { source: 'form' },
      },
    ];
    expect(safeParseManifest(raw).ok).toBe(false);
  });

  it('refuses a manifestVersion with no registered migration (§14.2)', () => {
    expect(() =>
      migrateManifest({ ...valid(), manifestVersion: CURRENT_MANIFEST_VERSION + 1 }),
    ).toThrow(/manifestVersion/);
    expect(() => migrateManifest({ manifestVersion: 0 })).toThrow(/supported manifestVersion/);
  });
});

describe('registry', () => {
  it('registers expand-url with the default manifest-driven stages', () => {
    const registry = buildRegistry(BUILTIN_SOURCES);
    const entry = registry.entries.get('expand-url');
    expect(entry?.manifest.execution.kind).toBe('builtin');
    expect(registry.rejected).toEqual([]);
    expect(
      entry?.inputAdapter.accepts([{ id: 'n1', kind: 'url', label: 'https://x.test', props: {} }]),
    ).toBe(true);
  });

  it('skips an invalid manifest and reports it instead of crashing boot (§4.3)', () => {
    const registry = buildRegistry([
      ...BUILTIN_SOURCES,
      { raw: { manifestVersion: 1, id: 'broken' }, parser: BUILTIN_SOURCES[0]!.parser },
    ]);
    expect(registry.entries.has('broken')).toBe(false);
    expect(registry.rejected[0]?.id).toBe('broken');
    expect(registry.rejected[0]?.issues.length).toBeGreaterThan(0);
  });
});
