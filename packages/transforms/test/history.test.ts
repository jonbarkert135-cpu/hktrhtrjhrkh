import { describe, expect, it } from 'vitest';

import {
  compareRuns,
  createRunHistory,
  isReplayRefusal,
  planReplay,
  runDurationMs,
  runResultCount,
  type RunEntity,
  type RunRecord,
} from '../src/history.ts';

import { buildRegistry, ctx, makeEngine, makeProvider, makeTransform } from './fixtures.ts';

const entity = (over: Partial<RunEntity> & { value: string }): RunEntity => ({
  kind: 'ip',
  confidence: 0.8,
  evidence: ['artifact://a'],
  ...over,
});

const run = (over: Partial<RunRecord> & { id: string }): RunRecord => ({
  transform: 'domain-to-ip',
  transformVersion: '1.0.0',
  input: { kind: 'domain', value: 'example.com' },
  engine: 'strong',
  engineVersion: '1.0.0',
  provider: 'free',
  mode: 'zero-credential',
  startedAt: 1_000,
  finishedAt: 3_000,
  status: 'completed',
  results: [],
  errors: [],
  ...over,
});

describe('run record', () => {
  it('derives duration and result count', () => {
    const record = run({ id: 'r1', results: [entity({ value: '1.1.1.1' })] });
    expect(runDurationMs(record)).toBe(2_000);
    expect(runResultCount(record)).toBe(1);
  });
});

describe('createRunHistory', () => {
  it('lists newest first and filters by transform and input', () => {
    const history = createRunHistory([run({ id: 'old', startedAt: 1 })]);
    history.record(run({ id: 'new', startedAt: 9 }));
    history.record(run({ id: 'other', transform: 'domain-to-mx', startedAt: 5 }));
    history.record(
      run({ id: 'elsewhere', startedAt: 7, input: { kind: 'domain', value: 'other.com' } }),
    );

    expect(history.all().map((r) => r.id)).toEqual(['new', 'elsewhere', 'other', 'old']);
    expect(history.get('new')?.id).toBe('new');
    expect(history.get('missing')).toBeUndefined();
    expect(history.forTransform('domain-to-ip').map((r) => r.id)).toEqual([
      'new',
      'elsewhere',
      'old',
    ]);
    expect(history.forInput({ kind: 'domain', value: 'example.com' }).map((r) => r.id)).toEqual([
      'new',
      'other',
      'old',
    ]);
  });

  it('replaces a run recorded twice under the same id', () => {
    const history = createRunHistory();
    history.record(run({ id: 'r1', status: 'running' }));
    history.record(run({ id: 'r1', status: 'completed' }));
    expect(history.all()).toHaveLength(1);
    expect(history.get('r1')?.status).toBe('completed');
  });
});

const transform = makeTransform({
  id: 'domain-to-ip',
  capability: 'dns',
  engines: ['weak', 'strong', 'manual-entry'],
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
  ],
  providers: [makeProvider({ id: 'free' })],
});

describe('planReplay', () => {
  it('re-routes against todays engines and keeps the original run', () => {
    const original = run({ id: 'r1', engine: 'weak' });
    const request = planReplay(registry, original, ctx());
    if (isReplayRefusal(request)) throw new Error('expected a replay request');

    expect(request.chain[0]).toBe('strong');
    expect(request.engineChanged).toBe(true);
    expect(request.replayOf).toBe('r1');
    expect(request.input).toEqual(original.input);
    expect(original.engine).toBe('weak');
  });

  it('reports no engine change when the routed first choice is the original one', () => {
    const request = planReplay(registry, run({ id: 'r2', engine: 'strong' }), ctx());
    if (isReplayRefusal(request)) throw new Error('expected a replay request');
    expect(request.engineChanged).toBe(false);
  });

  it('refuses when the transform no longer exists', () => {
    const request = planReplay(registry, run({ id: 'r3', transform: 'gone' }), ctx());
    expect(isReplayRefusal(request) && request.reason).toBe('not-executable');
  });

  it('refuses with the routing reason when nothing is usable today', () => {
    const request = planReplay(registry, run({ id: 'r4' }), ctx('strict-local'));
    expect(isReplayRefusal(request) && request.reason).toBe('blocked-by-mode');
  });
});

describe('compareRuns', () => {
  it('splits results into added, removed, changed and unchanged', () => {
    const before = run({
      id: 'a',
      results: [
        entity({ value: '1.1.1.1' }),
        entity({ value: '2.2.2.2' }),
        entity({ value: '3.3.3.3', confidence: 0.5 }),
      ],
    });
    const after = run({
      id: 'b',
      results: [
        entity({ value: '1.1.1.1' }),
        entity({ value: '3.3.3.3', confidence: 0.9 }),
        entity({ value: '4.4.4.4', evidence: ['artifact://b'] }),
      ],
    });

    const diff = compareRuns(before, after);
    expect(diff.added.map((e) => e.value)).toEqual(['4.4.4.4']);
    expect(diff.removed.map((e) => e.value)).toEqual(['2.2.2.2']);
    expect(diff.changed.map((c) => c.after.value)).toEqual(['3.3.3.3']);
    expect(diff.unchanged.map((e) => e.value)).toEqual(['1.1.1.1']);
  });

  it('treats extra evidence on the same entity as a change', () => {
    const diff = compareRuns(
      run({ id: 'a', results: [entity({ value: '1.1.1.1' })] }),
      run({
        id: 'b',
        results: [entity({ value: '1.1.1.1', evidence: ['artifact://a', 'artifact://b'] })],
      }),
    );
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.newEvidence).toEqual(['artifact://b']);
  });

  it('distinguishes entities with the same value but a different kind', () => {
    const diff = compareRuns(
      run({ id: 'a', results: [entity({ kind: 'ip', value: 'x' })] }),
      run({ id: 'b', results: [entity({ kind: 'hostname', value: 'x' })] }),
    );
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
  });
});
