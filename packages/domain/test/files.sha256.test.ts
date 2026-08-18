import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Sha256, isSha256Hex, sha256Hex } from '../src/files/sha256.ts';

const nodeHash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

describe('Sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      sha256Hex(
        new TextEncoder().encode(
          'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', // 56 bytes: two blocks
        ),
      ),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('agrees with node:crypto for a 3 MB payload hashed in one call', () => {
    const data = new Uint8Array(randomBytes(3 * 1024 * 1024));
    expect(sha256Hex(data)).toBe(nodeHash(data));
  });

  it('produces the same digest whatever the chunk boundaries are', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 2048 }),
        fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 40 }),
        (data, chunkSizes) => {
          const hash = new Sha256();
          let offset = 0;
          for (const size of chunkSizes) {
            hash.update(data.subarray(offset, offset + size));
            offset += size;
          }
          hash.update(data.subarray(offset));
          expect(hash.hex()).toBe(nodeHash(data));
        },
      ),
      { numRuns: 120 },
    );
  });

  it('is stable across repeated hex() calls and refuses updates afterwards', () => {
    const hash = new Sha256().update(new TextEncoder().encode('raven'));
    const first = hash.hex();
    expect(hash.hex()).toBe(first);
    expect(() => hash.update(new Uint8Array([1]))).toThrow(/after hex/);
  });

  it('recognises only well-formed lowercase digests', () => {
    expect(isSha256Hex(sha256Hex(new Uint8Array([1])))).toBe(true);
    expect(isSha256Hex('ABC')).toBe(false);
    expect(isSha256Hex(sha256Hex(new Uint8Array([1])).toUpperCase())).toBe(false);
    expect(isSha256Hex(42)).toBe(false);
  });
});
