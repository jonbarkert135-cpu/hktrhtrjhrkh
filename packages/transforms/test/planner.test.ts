import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BUDGET,
  MENU_LIMIT,
  actionsFor,
  expand,
  type PlannerContext,
} from '../src/planner.ts';
import type { Budget } from '../src/types.ts';

import {
  MANUAL_ENGINE,
  MANUAL_PROVIDER,
  buildRegistry,
  ctx,
  makeEngine,
  makeProvider,
  makeTransform,
} from './fixtures.ts';

const plannerCtx = (
  over: Partial<PlannerContext> = {},
  budget: Partial<Budget> = {},
): PlannerContext => ({
  ...ctx(over.mode ?? 'configured', [...(over.configuredProviders ?? [])]),
  budget: { ...DEFAULT_BUDGET, ...budget },
  ...over,
});

const registry = buildRegistry({
  transforms: [
    makeTransform({
      id: 'domain-to-dns',
      capability: 'dns',
      inputs: ['domain'],
      outputs: ['ip'],
      engines: ['dns-engine', 'manual-entry'],
      limits: { expectedRuntimeMs: 1_000, maxResults: 20, maxInputBatch: 10 },
    }),
    makeTransform({
      id: 'domain-to-certificates',
      capability: 'certificates',
      inputs: ['domain'],
      outputs: ['hostname'],
      engines: ['cert-engine', 'manual-entry'],
      priority: 'recommended',
      limits: { expectedRuntimeMs: 2_000, maxResults: 30, maxInputBatch: 10 },
    }),
    makeTransform({
      id: 'ip-to-reputation',
      capability: 'reputation',
      inputs: ['ip'],
      outputs: ['reputation'],
      engines: ['paid-engine', 'manual-entry'],
      priority: 'recommended',
      limits: { expectedRuntimeMs: 1_500, maxResults: 5, maxInputBatch: 10 },
    }),
    makeTransform({
      id: 'domain-to-legacy',
      capability: 'legacy',
      inputs: ['domain'],
      outputs: ['note'],
      engines: ['dns-engine', 'manual-entry'],
      priority: 'deprecated',
    }),
  ],
  engines: [
    makeEngine({ id: 'dns-engine', capability: 'dns', provider: 'free' }),
    makeEngine({ id: 'cert-engine', capability: 'certificates', provider: 'free' }),
    makeEngine({
      id: 'paid-engine',
      capability: 'reputation',
      provider: 'paid',
      dataFlow: 'external-api',
      permissions: ['network', 'credentials'],
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

describe('actionsFor', () => {
  it('returns one transform per capability, best first', () => {
    const actions = actionsFor(registry, 'domain', plannerCtx());
    expect(actions.map((action) => action.transform.id)).toEqual([
      'domain-to-dns',
      'domain-to-certificates',
    ]);
  });

  it('never exceeds the menu limit', () => {
    const many = buildRegistry({
      transforms: Array.from({ length: 12 }, (_unused, index) =>
        makeTransform({ id: `t-${index}`, capability: `cap-${index}` }),
      ),
      engines: [makeEngine({ id: 'engine-a', capability: 'dns', provider: 'p' }), MANUAL_ENGINE],
      providers: [makeProvider({ id: 'p' }), MANUAL_PROVIDER],
    });
    expect(actionsFor(many, 'domain', plannerCtx())).toHaveLength(MENU_LIMIT);
  });

  it('hides deprecated transforms', () => {
    const ids = actionsFor(registry, 'domain', plannerCtx()).map((a) => a.transform.id);
    expect(ids).not.toContain('domain-to-legacy');
  });

  it('keeps an unusable transform in the menu, but after the usable ones and with a reason', () => {
    const actions = actionsFor(registry, 'ip', plannerCtx());
    expect(actions).toHaveLength(1);
    expect(actions[0]?.reason).toBe('requires-configuration');
  });

  it('demotes capabilities that already ran on this entity', () => {
    const actions = actionsFor(
      registry,
      'domain',
      plannerCtx({ coveredCapabilities: new Set(['dns']) }),
    );
    expect(actions.map((action) => action.transform.id)).toEqual([
      'domain-to-certificates',
      'domain-to-dns',
    ]);
  });
});

describe('expand', () => {
  it('plans one hop by default and reports what it left out', () => {
    const plan = expand(registry, 'domain', plannerCtx());
    expect(plan.steps.map((step) => step.transform)).toEqual([
      'domain-to-dns',
      'domain-to-certificates',
    ]);
    expect(plan.estimate.maxEntities).toBe(50);
    expect(plan.requiresNetwork).toBe(true);
    expect(plan.providersUsed).toEqual(['free']);
    expect(plan.credentialsNeeded).toEqual([]);
  });

  it('excludes a second-layer transform whose provider is not configured', () => {
    const plan = expand(registry, 'domain', plannerCtx(), 2);
    expect(plan.steps.every((step) => step.depth === 1)).toBe(true);
    expect(plan.excluded).toContainEqual({
      transform: 'ip-to-reputation',
      reason: 'requires-configuration',
    });
  });

  it('runs the second layer once the paid provider is configured', () => {
    const plan = expand(
      registry,
      'domain',
      plannerCtx({ configuredProviders: new Set(['paid']) }),
      2,
    );
    const second = plan.steps.filter((step) => step.depth === 2);
    expect(second.map((step) => step.transform)).toEqual(['ip-to-reputation']);
    expect(second[0]?.dependsOn).toEqual(['domain-to-dns']);
    expect(plan.credentialsNeeded).toEqual(['paid']);
  });

  it('honours maxTransforms', () => {
    const plan = expand(registry, 'domain', plannerCtx({}, { maxTransforms: 1 }));
    expect(plan.steps).toHaveLength(1);
    expect(plan.excluded).toContainEqual({
      transform: 'domain-to-certificates',
      reason: 'budget-exhausted',
    });
  });

  it('caps results at the node budget instead of promising more', () => {
    const plan = expand(registry, 'domain', plannerCtx({}, { maxNewNodes: 25 }));
    expect(plan.estimate.maxEntities).toBe(25);
    expect(plan.steps[0]?.maxResults).toBe(20);
    expect(plan.steps[1]?.maxResults).toBe(5);
  });

  it('excludes a transform that cannot fit the runtime budget', () => {
    const plan = expand(registry, 'domain', plannerCtx({}, { maxRuntimeMs: 1_200 }));
    expect(plan.steps.map((step) => step.transform)).toEqual(['domain-to-dns']);
    expect(plan.excluded).toContainEqual({
      transform: 'domain-to-certificates',
      reason: 'budget-exhausted',
    });
  });

  it('never plans deeper than the budget allows', () => {
    const plan = expand(
      registry,
      'domain',
      plannerCtx({ configuredProviders: new Set(['paid']) }, { maxDepth: 1 }),
      'deep',
    );
    expect(plan.steps.every((step) => step.depth === 1)).toBe(true);
  });

  it('estimates runtime per parallel layer, not as a naive sum', () => {
    const serial = expand(registry, 'domain', plannerCtx({}, { maxParallel: 1 }));
    const parallel = expand(registry, 'domain', plannerCtx({}, { maxParallel: 4 }));
    expect(serial.estimate.runtimeMs).toBe(4_000); // 2 batches × slowest 2 s
    expect(parallel.estimate.runtimeMs).toBe(2_000); // one batch, slowest step
  });

  it('marks a plan that stays on the machine as not requiring the network', () => {
    const localRegistry = buildRegistry({
      transforms: [
        makeTransform({
          id: 'file-to-hashes',
          capability: 'hashing',
          inputs: ['file'],
          outputs: ['hash'],
          engines: ['hasher', 'manual-entry'],
        }),
      ],
      engines: [
        makeEngine({
          id: 'hasher',
          capability: 'hashing',
          provider: 'local',
          dataFlow: 'local',
          permissions: ['filesystem'],
        }),
        MANUAL_ENGINE,
      ],
      providers: [makeProvider({ id: 'local', pricing: 'local' }), MANUAL_PROVIDER],
    });
    const plan = expand(localRegistry, 'file', plannerCtx({ mode: 'strict-local' }));
    expect(plan.requiresNetwork).toBe(false);
    expect(plan.steps).toHaveLength(1);
  });

  it('returns an empty plan with reasons when nothing may run', () => {
    const plan = expand(registry, 'domain', plannerCtx({ mode: 'strict-local' }));
    expect(plan.steps).toEqual([]);
    expect(plan.excluded.map((entry) => entry.reason)).toEqual([
      'blocked-by-mode',
      'blocked-by-mode',
    ]);
    expect(plan.estimate).toEqual({ runtimeMs: 0, minEntities: 0, maxEntities: 0 });
  });
});
