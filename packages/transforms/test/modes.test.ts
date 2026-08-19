import { describe, expect, it } from 'vitest';

import { engineExclusion } from '../src/modes.ts';
import type { ExecutionMode } from '../src/types.ts';

import { ctx, makeEngine, makeProvider } from './fixtures.ts';

const localEngine = makeEngine({
  id: 'local-engine',
  capability: 'dns',
  provider: 'local',
  dataFlow: 'local',
  permissions: ['filesystem'],
});
const localProvider = makeProvider({ id: 'local', pricing: 'local' });

const keylessEngine = makeEngine({ id: 'keyless', capability: 'dns', provider: 'keyless' });
const keylessProvider = makeProvider({ id: 'keyless' });

const freeKeyEngine = makeEngine({
  id: 'free-key',
  capability: 'dns',
  provider: 'free-key',
  dataFlow: 'external-api',
  permissions: ['network', 'credentials'],
});
const freeKeyProvider = makeProvider({
  id: 'free-key',
  credentialClass: 'B',
  credentials: 'required',
  pricing: 'free',
  status: 'not-configured',
});

const paidEngine = makeEngine({
  id: 'paid',
  capability: 'dns',
  provider: 'paid',
  dataFlow: 'external-api',
  permissions: ['network', 'credentials'],
});
const paidProvider = makeProvider({
  id: 'paid',
  credentialClass: 'D',
  credentials: 'required',
  pricing: 'paid',
  status: 'not-configured',
});

const modes: readonly ExecutionMode[] = [
  'strict-local',
  'zero-credential',
  'free-tier',
  'configured',
  'maximum-coverage',
];

describe('execution modes', () => {
  it('strict-local allows only local engines', () => {
    expect(engineExclusion(localEngine, localProvider, ctx('strict-local'))).toBeUndefined();
    expect(engineExclusion(keylessEngine, keylessProvider, ctx('strict-local'))).toBe(
      'blocked-by-mode',
    );
  });

  it('zero-credential allows keyless network engines but nothing needing a key', () => {
    const mode = ctx('zero-credential', ['free-key']);
    expect(engineExclusion(keylessEngine, keylessProvider, mode)).toBeUndefined();
    expect(engineExclusion(freeKeyEngine, freeKeyProvider, mode)).toBe('blocked-by-mode');
  });

  it('free-tier allows a configured free key but never a paid provider', () => {
    const mode = ctx('free-tier', ['free-key', 'paid']);
    expect(engineExclusion(freeKeyEngine, freeKeyProvider, mode)).toBeUndefined();
    expect(engineExclusion(paidEngine, paidProvider, mode)).toBe('paid-only');
  });

  it('configured allows a paid provider only once its credentials exist', () => {
    expect(engineExclusion(paidEngine, paidProvider, ctx('configured', ['paid']))).toBeUndefined();
    expect(engineExclusion(paidEngine, paidProvider, ctx('configured'))).toBe(
      'requires-configuration',
    );
  });

  it('local engines run in every mode', () => {
    for (const mode of modes) {
      expect(engineExclusion(localEngine, localProvider, ctx(mode))).toBeUndefined();
    }
  });

  it('refuses an engine whose permissions the workspace has not granted', () => {
    expect(engineExclusion(keylessEngine, keylessProvider, ctx('configured', [], []))).toBe(
      'permission-denied',
    );
  });

  it('reports provider status problems with the status, not a generic error', () => {
    const cases = [
      ['disabled', 'provider-unavailable'],
      ['unavailable', 'provider-unavailable'],
      ['rate-limited', 'provider-rate-limited'],
      ['invalid', 'requires-configuration'],
      ['deprecated', 'provider-deprecated'],
    ] as const;
    for (const [status, expected] of cases) {
      const provider = makeProvider({ id: 'keyless', status });
      expect(engineExclusion(keylessEngine, provider, ctx('maximum-coverage'))).toBe(expected);
    }
  });

  it('never executes class E or F providers, but still allows a terminal link-out', () => {
    const external = makeProvider({ id: 'external', credentialClass: 'E' });
    const executing = makeEngine({ id: 'scraper', capability: 'dns', provider: 'external' });
    const linkOut = makeEngine({
      id: 'external-link',
      capability: 'terminal',
      provider: 'external',
      terminal: true,
    });
    expect(engineExclusion(executing, external, ctx('maximum-coverage'))).toBe('not-executable');
    expect(engineExclusion(linkOut, external, ctx('maximum-coverage'))).toBeUndefined();
  });

  it('reports an unavailable engine before anything else', () => {
    const broken = makeEngine({
      id: 'broken',
      capability: 'dns',
      provider: 'keyless',
      status: 'unavailable',
    });
    expect(engineExclusion(broken, keylessProvider, ctx('configured'))).toBe('engine-unavailable');
  });

  it('reports a deprecated engine as deprecated', () => {
    const old = makeEngine({
      id: 'old',
      capability: 'dns',
      provider: 'keyless',
      status: 'deprecated',
    });
    expect(engineExclusion(old, keylessProvider, ctx('configured'))).toBe('provider-deprecated');
  });
});
