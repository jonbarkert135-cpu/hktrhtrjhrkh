import { describe, expect, it } from 'vitest';

import { routeForInput, routeTransform } from '../src/router.ts';
import { scoreEngine, scoreTransform } from '../src/score.ts';

import {
  MANUAL_ENGINE,
  MANUAL_PROVIDER,
  buildRegistry,
  ctx,
  makeEngine,
  makeProvider,
  makeTransform,
} from './fixtures.ts';

const transform = makeTransform({
  id: 'domain-to-ip',
  capability: 'dns',
  engines: ['weak', 'strong', 'paid', 'manual-entry'],
});

const registry = buildRegistry({
  transforms: [transform],
  engines: [
    makeEngine({
      id: 'weak',
      capability: 'dns',
      provider: 'free',
      quality: { resultQuality: 0.4, reliability: 0.5, maintenance: 0.5 },
    }),
    makeEngine({
      id: 'strong',
      capability: 'dns',
      provider: 'free',
      quality: { resultQuality: 0.95, reliability: 0.95, maintenance: 1 },
    }),
    makeEngine({
      id: 'paid',
      capability: 'dns',
      provider: 'paid',
      dataFlow: 'external-api',
      permissions: ['network', 'credentials'],
      quality: { resultQuality: 1, reliability: 1, maintenance: 1 },
    }),
    MANUAL_ENGINE,
  ],
  providers: [
    makeProvider({ id: 'free' }),
    makeProvider({
      id: 'paid',
      credentialClass: 'D',
      credentials: 'required',
      pricing: 'paid',
      status: 'not-configured',
    }),
    MANUAL_PROVIDER,
  ],
});

describe('routeTransform', () => {
  it('orders usable engines by score and puts the terminal fallback last', () => {
    const routed = routeTransform(registry, transform, ctx('configured', ['paid']));
    // 'strong' beats 'paid' despite worse quality signals: it is a plain network call, while the
    // paid engine is an external API, and privacy is 15 % of the score.
    expect(routed.chain.map((entry) => entry.engine.id)).toEqual([
      'strong',
      'paid',
      'weak',
      'manual-entry',
    ]);
    expect(routed.reason).toBeUndefined();
  });

  it('drops the paid engine in free-tier mode and says why', () => {
    const routed = routeTransform(registry, transform, ctx('free-tier'));
    expect(routed.chain.map((entry) => entry.engine.id)).toEqual([
      'strong',
      'weak',
      'manual-entry',
    ]);
    expect(routed.rejected.map((entry) => entry.reason)).toEqual(['paid-only']);
  });

  it('reports the most actionable reason when nothing can execute', () => {
    const routed = routeTransform(registry, transform, ctx('strict-local'));
    expect(routed.chain.map((entry) => entry.engine.id)).toEqual(['manual-entry']);
    // Every engine is non-local, so the mode is the binding constraint — and switching mode is
    // the action the analyst can take.
    expect(routed.reason).toBe('blocked-by-mode');
    expect(routed.score).toBe(0);
  });

  it('falls back to no-engine when every engine is missing its provider', () => {
    const broken = buildRegistry({
      transforms: [makeTransform({ id: 'a-b', capability: 'dns', engines: ['ghost'] })],
      engines: [MANUAL_ENGINE],
      providers: [MANUAL_PROVIDER],
    });
    const routed = routeTransform(broken, broken.transforms[0]!, ctx());
    expect(routed.reason).toBe('no-engine');
  });

  it('scores the transform from its best executable engine and its priority', () => {
    const routed = routeTransform(registry, transform, ctx('free-tier'));
    const best = scoreEngine(registry.engine('strong')!, 'configured').total;
    expect(routed.score).toBeCloseTo(scoreTransform(transform, best), 10);
  });
});

describe('routeForInput', () => {
  it('ranks every transform accepting the kind, best first', () => {
    const many = buildRegistry({
      transforms: [
        transform,
        makeTransform({
          id: 'domain-to-whois',
          capability: 'whois',
          priority: 'optional',
          engines: ['whois', 'manual-entry'],
        }),
      ],
      engines: [
        ...registry.engines,
        makeEngine({ id: 'whois', capability: 'whois', provider: 'free' }),
      ],
      providers: [...registry.providers],
    });
    const routed = routeForInput(many, 'domain', ctx('free-tier'));
    expect(routed.map((entry) => entry.transform.id)).toEqual(['domain-to-ip', 'domain-to-whois']);
  });

  it('returns nothing for a kind no transform accepts', () => {
    expect(routeForInput(registry, 'phone', ctx())).toEqual([]);
  });
});
