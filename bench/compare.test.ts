import { describe, expect, it } from 'vitest';
import { compare, toMarkdown } from './compare.mjs';

const metric = (value: number | null, budget: number) => ({ value, unit: 'ms' as const, budget });

describe('bench compare', () => {
  it('reports a new baseline when no previous value exists', () => {
    const { rows, failures } = compare({ a: metric(10, 16.6) }, {});
    expect(rows[0]?.verdict).toBe('new baseline');
    expect(failures).toEqual([]);
  });

  it('fails a metric that regressed by more than the allowed fraction', () => {
    const { failures } = compare({ a: metric(11, 100) }, { a: metric(10, 100) }, 0.05);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('10.0% slower');
  });

  it('accepts a regression inside the allowed fraction', () => {
    const { failures } = compare({ a: metric(10.4, 100) }, { a: metric(10, 100) }, 0.05);
    expect(failures).toEqual([]);
  });

  it('fails a metric over its absolute budget even without a baseline', () => {
    const { failures } = compare({ a: metric(20, 16.6) }, {});
    expect(failures[0]).toContain('exceeds the budget');
  });

  it('never invents a number for an unmeasured metric', () => {
    const { rows, failures } = compare(
      { a: { value: null, unit: 'ms', budget: 16.6, note: 'engine lands in P2' } },
      {},
    );
    expect(rows[0]?.current).toBeNull();
    expect(rows[0]?.verdict).toContain('P2');
    expect(failures).toEqual([]);
  });

  it('renders a markdown table for the PR comment', () => {
    const { rows } = compare({ a: metric(10, 100) }, {});
    expect(toMarkdown(rows).split('\n')).toHaveLength(3);
  });
});
