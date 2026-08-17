import { describe, expect, it } from 'vitest';
import { parseFlags, UnknownFlagError } from '../src/flags';

describe('parseFlags', () => {
  it('returns an empty set for an empty csv', () => {
    expect(parseFlags('').enabled.size).toBe(0);
  });

  it('enables every listed flag and ignores whitespace', () => {
    const flags = parseFlags(' views.map , ai.summarize ');
    expect(flags.isEnabled('views.map')).toBe(true);
    expect(flags.isEnabled('ai.summarize')).toBe(true);
    expect(flags.isEnabled('views.timeline')).toBe(false);
  });

  it('throws on an unknown flag name so boot fails on a typo', () => {
    expect(() => parseFlags('views.maps')).toThrow(UnknownFlagError);
  });
});
