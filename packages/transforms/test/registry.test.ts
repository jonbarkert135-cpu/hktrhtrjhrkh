import { describe, expect, it } from 'vitest';

import { createTransformRegistry } from '../src/registry.ts';

import {
  MANUAL_ENGINE,
  MANUAL_PROVIDER,
  buildRegistry,
  makeEngine,
  makeProvider,
  makeTransform,
} from './fixtures.ts';

describe('registry lookups', () => {
  const registry = buildRegistry();

  it('indexes transforms by input kind', () => {
    expect(registry.forInput('domain').map((t) => t.id)).toEqual(['domain-to-ip']);
    expect(registry.forInput('email')).toEqual([]);
  });

  it('indexes transforms by capability', () => {
    expect(registry.forCapability('dns')).toHaveLength(1);
    expect(registry.forCapability('nothing')).toEqual([]);
  });

  it('resolves manifests by id', () => {
    expect(registry.transform('domain-to-ip')?.name).toBe('domain-to-ip');
    expect(registry.engine('engine-a')?.capability).toBe('dns');
    expect(registry.provider('provider-a')?.credentialClass).toBe('A');
    expect(registry.transform('missing')).toBeUndefined();
    expect(registry.engine('missing')).toBeUndefined();
    expect(registry.provider('missing')).toBeUndefined();
  });

  it('returns engines in the declared preference order and skips unknown ids', () => {
    const transform = makeTransform({
      id: 'domain-to-ip',
      capability: 'dns',
      engines: ['ghost', 'engine-a', 'manual-entry'],
    });
    const registry2 = buildRegistry({ transforms: [transform] });
    expect(registry2.enginesFor(transform).map((e) => e.id)).toEqual(['engine-a', 'manual-entry']);
  });
});

describe('registry validation', () => {
  it('passes on a healthy registry', () => {
    expect(buildRegistry().validate()).toEqual([]);
  });

  it('reports an unknown engine reference', () => {
    const issues = buildRegistry({
      transforms: [makeTransform({ id: 'a-b', capability: 'dns', engines: ['ghost'] })],
    }).validate();
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'transform', message: expect.stringContaining('ghost') }),
    );
  });

  it('reports a capability mismatch between transform and engine', () => {
    const issues = buildRegistry({
      transforms: [makeTransform({ id: 'a-b', capability: 'whois' })],
    }).validate();
    expect(issues.some((issue) => issue.message.includes('implements "dns"'))).toBe(true);
  });

  it('does not treat a terminal engine as a capability mismatch', () => {
    const issues = buildRegistry().validate();
    expect(issues).toEqual([]);
  });

  it('reports a chain with no terminal engine: a dead end for the analyst', () => {
    const issues = buildRegistry({
      transforms: [makeTransform({ id: 'a-b', capability: 'dns', engines: ['engine-a'] })],
    }).validate();
    expect(issues).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('terminal engine') }),
    );
  });

  it('reports an engine pointing at an unknown provider', () => {
    const issues = createTransformRegistry({
      transforms: [makeTransform({ id: 'a-b', capability: 'dns' })],
      engines: [
        makeEngine({ id: 'engine-a', capability: 'dns', provider: 'ghost' }),
        MANUAL_ENGINE,
      ],
      providers: [MANUAL_PROVIDER],
    }).validate();
    expect(issues).toContainEqual(expect.objectContaining({ kind: 'engine', id: 'engine-a' }));
  });

  it('reports an unknown alternative provider', () => {
    const issues = buildRegistry({
      providers: [makeProvider({ id: 'provider-a', alternatives: ['ghost'] }), MANUAL_PROVIDER],
    }).validate();
    expect(issues).toContainEqual(expect.objectContaining({ kind: 'provider', id: 'provider-a' }));
  });

  it('reports duplicate transform ids', () => {
    const issues = buildRegistry({
      transforms: [
        makeTransform({ id: 'a-b', capability: 'dns' }),
        makeTransform({ id: 'a-b', capability: 'dns' }),
      ],
    }).validate();
    expect(issues).toContainEqual(expect.objectContaining({ message: 'duplicate transform id' }));
  });

  it('throws on a malformed manifest instead of silently dropping it', () => {
    expect(() =>
      createTransformRegistry({ transforms: [{ id: 'broken' }], engines: [], providers: [] }),
    ).toThrow();
  });
});
