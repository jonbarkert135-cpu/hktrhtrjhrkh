import { describe, expect, it } from 'vitest';

import { bucketOf, computeConfidence, noisyOr } from '../src/extract/confidence.ts';
import { normalize, isReservedIp } from '../src/extract/normalizers.ts';
import { scanText } from '../src/extract/patterns.ts';
import { identityFor, identityKey } from '../src/resolve/identity.ts';
import { decideField, resolveEntity, trigramSimilarity } from '../src/resolve/merge.ts';

describe('normalizers (§8.1)', () => {
  it('canonicalizes domains and rejects bare public suffixes', () => {
    expect(normalize('domain', 'WWW.Example.COM.').value).toBe('example.com');
    expect(normalize('domain', 'bücher.de').value).toBe('xn--bcher-kva.de');
    expect(normalize('domain', 'co.uk').ok).toBe(false);
    expect(normalize('domain', 'localhost').ok).toBe(false);
  });

  it('normalizes URLs: case, default port, fragment, tracking params, param order', () => {
    const result = normalize('url', 'HTTPS://Example.com:443/a//b/?utm_source=x&b=2&a=1#frag');
    expect(result.value).toBe('https://example.com/a/b?a=1&b=2');
    expect(normalize('url', 'ftp://example.com').ok).toBe(false);
  });

  it('lowercases emails and strips +tags only for tag-supporting domains', () => {
    expect(normalize('email', 'A.B+spam@Gmail.com').value).toBe('a.b@gmail.com');
    expect(normalize('email', 'A.B+spam@Example.com').value).toBe('a.b+spam@example.com');
    expect(normalize('email', 'nope').ok).toBe(false);
  });

  it('keeps username display case and lowercases the key', () => {
    const result = normalize('username', ' @JohnDoe ');
    expect(result.value).toBe('johndoe');
    expect(result.display).toBe('JohnDoe');
  });

  it('qualifies handles by platform and downgrades unknown platforms', () => {
    expect(normalize('handle', 'github:JohnDoe').value).toBe('handle:github:johndoe');
    expect(normalize('handle', 'weirdnet:JohnDoe').meta?.downgraded).toBe(true);
  });

  it('rejects non-canonical and reserved IPs, compresses IPv6', () => {
    expect(normalize('ip', '010.1.1.1').ok).toBe(false);
    expect(normalize('ip', '169.254.169.254').ok).toBe(false);
    expect(normalize('ip', '2001:0db8:0000:0000:0000:0000:0000:0001').value).toBe('2001:db8::1');
    expect(isReservedIp('10.0.0.1')).toBe(true);
    expect(isReservedIp('8.8.8.8')).toBe(false);
  });

  it('classifies hashes by length and rejects unknown lengths', () => {
    expect(normalize('hash', 'A'.repeat(64)).meta?.hashAlgo).toBe('sha256');
    expect(normalize('hash', 'a'.repeat(31)).ok).toBe(false);
  });

  it('produces E.164 phone numbers, or reports that it cannot', () => {
    expect(normalize('phone', '+1 (415) 555-0132').value).toBe('+14155550132');
    expect(normalize('phone', '020 7946 0018', { defaultRegion: 'GB' }).value).toBe(
      '+442079460018',
    );
    expect(normalize('phone', 'call me').ok).toBe(false);
  });

  it('canonicalizes repositories from URLs and strips tree paths', () => {
    expect(normalize('repo', 'https://GitHub.com/Owner/Name.git/tree/main').value).toBe(
      'github.com/Owner/Name',
    );
    expect(normalize('repo', 'owner/name').ok).toBe(false);
  });
});

describe('identity and patterns', () => {
  it('builds kind-prefixed identity keys', () => {
    expect(identityKey('url', 'https://a.test/')).toBe('url:https://a.test/');
    expect(identityFor('email', 'A@B.test').key).toBe('email:a@b.test');
  });

  it('extracts entities from free text without shredding a URL into a domain', () => {
    const matches = scanText('see https://example.com/a and mail bob@example.com from 8.8.8.8');
    expect(matches.map((m) => m.kind)).toEqual(['url', 'email', 'ip']);
  });
});

describe('resolution (§8.3)', () => {
  const existing = {
    nodeId: 'n1',
    kind: 'url' as const,
    identityKey: 'url:https://a.test/',
    title: 'Acme corporation',
    props: { aliases: ['https://b.test/'], service: 'acme' },
    boardId: 'b1',
  };

  it('merges on exact identity, suggests a link across boards, merges on alias', () => {
    expect(
      resolveEntity(
        { kind: 'url', identityKey: 'url:https://a.test/', display: 'x', boardId: 'b1' },
        [existing],
      ).resolution,
    ).toBe('MERGE');
    expect(
      resolveEntity(
        { kind: 'url', identityKey: 'url:https://a.test/', display: 'x', boardId: 'b2' },
        [existing],
      ).resolution,
    ).toBe('SUGGEST_LINK');
    expect(
      resolveEntity(
        { kind: 'url', identityKey: 'url:https://b.test/', display: 'x', boardId: 'b1' },
        [existing],
      ).resolution,
    ).toBe('MERGE');
  });

  it('turns a near-duplicate title into a conflict, not a merge', () => {
    const result = resolveEntity(
      {
        kind: 'url',
        identityKey: 'url:https://c.test/',
        display: 'Acme corporatio',
        boardId: 'b1',
      },
      [existing],
    );
    expect(result.resolution).toBe('CONFLICT');
    expect(result.similarity).toBeGreaterThanOrEqual(0.82);
    expect(trigramSimilarity('acme corp', 'zzz')).toBe(0);
  });

  it('applies the per-field merge table', () => {
    expect(
      decideField({ field: 'a', current: '', incoming: 'x', incomingConfidence: 0.9 }).kind,
    ).toBe('set');
    expect(
      decideField({ field: 'a', current: 'x', incoming: 'x', incomingConfidence: 0.9 }).kind,
    ).toBe('skip');
    expect(
      decideField({ field: 'tags', current: ['a'], incoming: 'b', incomingConfidence: 0.9 }).kind,
    ).toBe('addToSet');
    expect(
      decideField({
        field: 'a',
        current: 'x',
        incoming: 'y',
        currentConfidence: 0.5,
        incomingConfidence: 0.9,
      }),
    ).toMatchObject({ kind: 'conflict', defaultResolution: 'replace' });
    expect(
      decideField({
        field: 'a',
        current: 'x',
        incoming: 'y',
        incomingConfidence: 0.9,
        props: { __manual: { a: true } },
      }),
    ).toMatchObject({ kind: 'conflict', defaultResolution: 'keep', manual: true });
  });
});

describe('confidence (§8.4)', () => {
  it('multiplies the factors and caps at 0.97', () => {
    expect(computeConfidence({ base: 0.75, source: 'assertion' })).toBeCloseTo(0.6375, 4);
    expect(computeConfidence({ base: 1, source: 'authoritative', evidence: 'corroborated' })).toBe(
      0.97,
    );
    expect(computeConfidence({ base: 0.9, source: 'authoritative', drift: 'minor' })).toBeCloseTo(
      0.72,
      4,
    );
  });

  it('combines corroborating observations with noisy-OR', () => {
    expect(noisyOr([0.7, 0.7])).toBeCloseTo(0.91, 2);
    expect(noisyOr([1, 1])).toBe(0.97);
    expect(bucketOf(0.9)).toBe('high');
    expect(bucketOf(0.61)).toBe('medium');
    expect(bucketOf(0.2)).toBe('low');
  });
});
