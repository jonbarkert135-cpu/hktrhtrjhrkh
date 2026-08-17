import { describe, expect, it } from 'vitest';
import { assertId, isId, newId, parseId } from '../src/ids';

describe('entity ids', () => {
  it('generates unique cuid2 ids per kind', () => {
    const ids = new Set([newId.org(), newId.org(), newId.project(), newId.board()]);
    expect(ids.size).toBe(4);
    for (const id of ids) expect(isId(id)).toBe(true);
  });

  it('exposes the kind on the factory', () => {
    expect(newId.membership.kind).toBe('membership');
  });

  it('rejects strings that are not cuid2', () => {
    expect(isId('')).toBe(false);
    expect(isId('not an id')).toBe(false);
    expect(isId(42)).toBe(false);
    expect(parseId('user', 'nope')).toBeUndefined();
    expect(() => assertId('user', 'nope')).toThrow(/Invalid user id/);
    // non-string input takes the other branch of the error-message helper
    expect(() => assertId('user', 42)).toThrow(/got number/);
  });

  it('passes a valid id through the validator unchanged', () => {
    const id = newId.user();
    expect(assertId('user', id)).toBe(id);
    expect(parseId('user', id)).toBe(id);
  });
});
