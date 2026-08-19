import { describe, expect, it } from 'vitest';

import { scoreEngine, scoreTransform } from '../src/score.ts';

import { makeEngine, makeTransform } from './fixtures.ts';

const perfect = {
  resultQuality: 1,
  reliability: 1,
  maintenance: 1,
} as const;

describe('scoreEngine', () => {
  it('gives a perfect local configured engine the maximum score', () => {
    const engine = makeEngine({
      id: 'local',
      capability: 'dns',
      provider: 'local',
      dataFlow: 'local',
      permissions: [],
      cost: 'fast',
      quality: perfect,
    });
    expect(scoreEngine(engine, 'configured').total).toBeCloseTo(1, 10);
  });

  it('prefers a local engine over an identical external one (privacy weight)', () => {
    const local = makeEngine({
      id: 'a',
      capability: 'dns',
      provider: 'p',
      dataFlow: 'local',
      permissions: [],
      quality: perfect,
    });
    const external = makeEngine({
      id: 'b',
      capability: 'dns',
      provider: 'p',
      dataFlow: 'external-api',
      quality: perfect,
    });
    expect(scoreEngine(local, 'configured').total).toBeGreaterThan(
      scoreEngine(external, 'configured').total,
    );
  });

  it('collapses the availability component for a dead provider', () => {
    const engine = makeEngine({ id: 'a', capability: 'dns', provider: 'p', quality: perfect });
    expect(scoreEngine(engine, 'unavailable').availability).toBe(0);
    expect(scoreEngine(engine, 'configured').availability).toBeGreaterThan(0);
  });

  it('exposes a breakdown that sums to the total', () => {
    const engine = makeEngine({ id: 'a', capability: 'dns', provider: 'p' });
    const { total, ...parts } = scoreEngine(engine, 'not-configured');
    const sum = Object.values(parts).reduce((acc, value) => acc + value, 0);
    expect(sum).toBeCloseTo(total, 10);
  });
});

describe('scoreTransform', () => {
  it('weights by priority', () => {
    const core = makeTransform({ id: 'a-b', capability: 'dns', priority: 'core' });
    const optional = makeTransform({ id: 'c-d', capability: 'dns', priority: 'optional' });
    expect(scoreTransform(core, 0.8)).toBeCloseTo(0.8, 10);
    expect(scoreTransform(optional, 0.8)).toBeCloseTo(0.56, 10);
  });

  it('zeroes a deprecated transform however good its engine is', () => {
    const deprecated = makeTransform({ id: 'a-b', capability: 'dns', priority: 'deprecated' });
    expect(scoreTransform(deprecated, 1)).toBe(0);
  });
});
