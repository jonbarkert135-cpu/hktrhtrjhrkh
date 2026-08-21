import { describe, expect, it } from 'vitest';

import { manifest as expandUrl } from '../builtin/manifest.ts';
import {
  assertConsentValid,
  assertTargetsAllowed,
  consentTtlMs,
  hashText,
  inputHash,
  rateLimitKeys,
  redactInput,
  targetsHash,
  type ConsentRecord,
} from '../src/consent.ts';
import { INTEGRATION_ERROR_CODES, payloadFor, retryDelayMs, shouldRetry } from '../src/errors.ts';
import { parseFixture, memoryLogger } from '../src/testkit/index.ts';
import { parser } from '../builtin/parser.ts';
import { manifestInputAdapter, versionDrift } from '../src/pipeline.ts';

const NOW = '2026-02-01T00:00:00.000Z';
const targets = [
  { kind: 'url' as const, value: 'https://sho.rt/x', scope: 'public-index' as const },
];

const consent = (overrides: Partial<ConsentRecord> = {}): ConsentRecord => ({
  id: 'c1',
  orgId: 'o1',
  projectId: 'p1',
  userId: 'u1',
  integrationId: expandUrl.id,
  scope: 'public-index',
  targetsHash: targetsHash(targets),
  scopeTextHash: hashText(expandUrl.consent.scopeText),
  acceptedAt: NOW,
  expiresAt: '2026-02-02T00:00:00.000Z',
  ...overrides,
});

describe('consent gate (§12)', () => {
  it('accepts a matching consent and rejects a missing one', () => {
    expect(
      assertConsentValid({
        manifest: expandUrl,
        consent: consent(),
        targets,
        projectId: 'p1',
        userId: 'u1',
        now: NOW,
      }).id,
    ).toBe('c1');
    expect(() =>
      assertConsentValid({
        manifest: expandUrl,
        consent: null,
        targets,
        projectId: 'p1',
        userId: 'u1',
        now: NOW,
      }),
    ).toThrow(/CONSENT_REQUIRED/);
  });

  it('rejects expired, revoked, re-worded and re-targeted consents', () => {
    const check = { manifest: expandUrl, targets, projectId: 'p1', userId: 'u1', now: NOW };
    expect(() => assertConsentValid({ ...check, consent: consent({ expiresAt: NOW }) })).toThrow(
      /CONSENT_EXPIRED/,
    );
    expect(() => assertConsentValid({ ...check, consent: consent({ revokedAt: NOW }) })).toThrow(
      /CONSENT_EXPIRED/,
    );
    expect(() =>
      assertConsentValid({ ...check, consent: consent({ scopeTextHash: 'x' }) }),
    ).toThrow(/CONSENT_EXPIRED/);
    expect(() => assertConsentValid({ ...check, consent: consent({ targetsHash: 'x' }) })).toThrow(
      /CONSENT_EXPIRED/,
    );
  });

  it('scopes consent validity by risk label', () => {
    expect(consentTtlMs('high')).toBe(0);
    expect(consentTtlMs('medium')).toBe(86_400_000);
    expect(consentTtlMs('low')).toBe(604_800_000);
  });

  it('enforces the allowed-target policy and the hard denylist (§12.2)', () => {
    expect(() =>
      assertTargetsAllowed(expandUrl, targets, { allowedScopes: ['public-index'] }),
    ).not.toThrow();
    expect(() =>
      assertTargetsAllowed(expandUrl, targets, { allowedScopes: ['owned-asset'] }),
    ).toThrow(/TARGET_NOT_ALLOWED/);
    expect(() =>
      assertTargetsAllowed(expandUrl, [{ kind: 'ip', value: '10.0.0.1', scope: 'public-index' }], {
        allowedScopes: ['public-index'],
      }),
    ).toThrow(/TARGET_NOT_ALLOWED/);
    expect(() =>
      assertTargetsAllowed(expandUrl, targets, {
        allowedScopes: ['public-index'],
        neverScan: ['sho.rt'],
      }),
    ).toThrow(/TARGET_NOT_ALLOWED/);
  });

  it('derives stable rate-limit keys and input hashes', () => {
    const keys = rateLimitKeys({ userId: 'u1', orgId: 'o1', integrationId: 'expand-url', targets });
    expect(keys.user).toBe('user:u1:expand-url');
    expect(keys.concurrency).toBe('concurrency:o1');
    expect(keys.targets).toHaveLength(1);
    expect(inputHash('expand-url', { b: 1, a: 2 })).toBe(inputHash('expand-url', { a: 2, b: 1 }));
    expect(inputHash('expand-url', { a: 1 })).not.toBe(inputHash('expand-url', { a: 2 }));
  });

  it('redacts secretRef inputs before they reach storage (§6.6)', () => {
    const manifest = {
      ...expandUrl,
      inputs: [{ ...expandUrl.inputs[0]!, name: 'token', type: 'secretRef' as const }],
    };
    expect(redactInput(manifest, { token: 'github.pat' })).toEqual({
      token: { secretRef: 'github.pat' },
    });
  });
});

describe('error taxonomy (§11)', () => {
  it('has canonical three-sentence copy for every code', () => {
    for (const code of INTEGRATION_ERROR_CODES) {
      const payload = payloadFor(code);
      expect(payload.what.length).toBeGreaterThan(0);
      expect(payload.what.length).toBeLessThanOrEqual(90);
      expect(payload.why.length).toBeLessThanOrEqual(140);
      expect(payload.action.length).toBeLessThanOrEqual(90);
    }
  });

  it('implements the retry policy table', () => {
    expect(shouldRetry('QUEUE_TIMEOUT', 1)).toBe(true);
    expect(shouldRetry('QUEUE_TIMEOUT', 2)).toBe(false);
    expect(shouldRetry('EGRESS_DENIED', 1)).toBe(false);
    expect(shouldRetry('TOOL_EXIT_NONZERO', 1)).toBe(false);
    expect(retryDelayMs('UPSTREAM_UNAVAILABLE', 1, () => 0.5)).toBe(2000);
    expect(retryDelayMs('EGRESS_DENIED', 1)).toBeUndefined();
  });
});

describe('expand-url adapter and parser', () => {
  it('adapts a selected URL node into the tool input and one target', () => {
    const adapter = manifestInputAdapter(expandUrl);
    const result = adapter.adapt({
      integrationId: expandUrl.id,
      boardId: 'b1',
      selection: [{ id: 'n1', kind: 'url', label: 'https://sho.rt/x', props: {} }],
      formValues: {},
      actorUserId: 'u1',
    });
    expect(result.input).toEqual({ url: 'https://sho.rt/x' });
    expect(result.targets).toEqual([
      { kind: 'url', value: 'https://sho.rt/x', scope: 'public-index' },
    ]);
  });

  it('rejects an input that fails the manifest pattern', () => {
    const adapter = manifestInputAdapter(expandUrl);
    expect(() =>
      adapter.adapt({
        integrationId: expandUrl.id,
        boardId: 'b1',
        selection: [],
        formValues: { url: 'javascript:alert(1)' },
        actorUserId: 'u1',
      }),
    ).toThrow(/INPUT_INVALID/);
  });

  it('parses a redirect chain into one record', async () => {
    const document = await parseFixture(
      parser,
      expandUrl,
      JSON.stringify({
        version: '1.0',
        inputUrl: 'https://sho.rt/x',
        finalUrl: 'https://example.test/landing',
        hops: 2,
        status: 200,
        chain: ['https://sho.rt/x', 'https://example.test/landing'],
        observedAt: NOW,
      }),
    );
    expect(document.records).toHaveLength(1);
    expect(document.records[0]?.data.finalUrl).toBe('https://example.test/landing');
  });

  it('reports an already-canonical URL as zero records, not an error (§8 edge cases)', async () => {
    const document = await parseFixture(
      parser,
      expandUrl,
      JSON.stringify({
        version: '1.0',
        inputUrl: 'https://example.test/',
        finalUrl: 'https://example.test/',
        hops: 0,
        status: 200,
        chain: [],
        observedAt: NOW,
      }),
    );
    expect(document.records).toEqual([]);
    expect(document.nonFatalIssues).toHaveLength(1);
  });

  it('throws PARSE_UNSUPPORTED_SHAPE on a document it cannot recognize', async () => {
    await expect(parseFixture(parser, expandUrl, 'not json at all')).rejects.toThrow(
      /PARSE_UNSUPPORTED_SHAPE/,
    );
    await expect(parseFixture(parser, expandUrl, '{"version":"1.0"}')).rejects.toThrow(
      /PARSE_UNSUPPORTED_SHAPE/,
    );
  });

  it('classifies tool version drift (§4.6)', () => {
    expect(versionDrift('1.0', ['1.0'], '1.0.0')).toBe('exact');
    expect(versionDrift('1.0.3', ['1.0.1'], '1.0.0')).toBe('patch');
    expect(versionDrift('1.4', ['1.0'], '1.0.0')).toBe('minor');
    expect(versionDrift('3.0', ['1.0'], '1.0.0')).toBe('major');
  });

  it('collects run log lines through the testkit logger', () => {
    const logger = memoryLogger();
    logger.log({ level: 'info', phase: 'parse', message: 'ok' });
    expect(logger.lines).toEqual(['info parse ok']);
  });
});
