/** Third-party plugin discovery (§4.3): declarative manifests only, bad files surfaced. */

import { describe, expect, it } from 'vitest';

import { manifest as expandUrl } from '../builtin/manifest.ts';
import { discoverPlugins, type PluginFs } from '../src/plugins.ts';
import { buildRegistry, BUILTIN_SOURCES, loadRegistry } from '../src/registry.ts';

const fsWith = (files: Record<string, string>): PluginFs => ({
  readdir: () => Promise.resolve(Object.keys(files)),
  readFile: (path: string) => {
    const body = files[path.split('/').pop() ?? ''];
    return body === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(body);
  },
});

const pluginManifest = (id: string): string =>
  JSON.stringify({ ...JSON.parse(JSON.stringify(expandUrl)), id, publisher: { name: 'Third' } });

describe('discoverPlugins', () => {
  it('loads every json manifest in the directory, sorted, ignoring other files', async () => {
    const sources = await discoverPlugins(
      '/plugins/',
      fsWith({
        'b.json': pluginManifest('plugin-b'),
        'a.json': pluginManifest('plugin-a'),
        'readme.md': '# not a manifest',
      }),
    );

    expect(sources).toHaveLength(2);
    const registry = buildRegistry(sources);
    expect([...registry.entries.keys()]).toEqual(['plugin-a', 'plugin-b']);
  });

  it('surfaces an unparsable file as a rejection instead of throwing', async () => {
    const sources = await discoverPlugins('/plugins', fsWith({ 'broken.json': '{oops' }));
    const registry = buildRegistry(sources);

    expect(registry.entries.size).toBe(0);
    expect(registry.rejected[0]?.id).toBe('broken');
    expect(registry.rejected[0]?.issues.length).toBeGreaterThan(0);
  });

  it('treats a missing directory as no plugins', async () => {
    const fs: PluginFs = {
      readdir: () => Promise.reject(new Error('ENOENT')),
      readFile: () => Promise.reject(new Error('ENOENT')),
    };

    await expect(discoverPlugins('/nope', fs)).resolves.toEqual([]);
  });

  it('reaches the registry only when third party loading is enabled', async () => {
    const thirdParty = await discoverPlugins(
      '/plugins',
      fsWith({ 'a.json': pluginManifest('plugin-p') }),
    );

    const off = await loadRegistry({ thirdParty });
    const on = await loadRegistry({ includeThirdParty: true, thirdParty });

    expect(off.entries.size).toBe(BUILTIN_SOURCES.length);
    expect(on.entries.has('plugin-p')).toBe(true);
  });
});
