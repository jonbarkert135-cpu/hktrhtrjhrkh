import { describe, expect, it, vi } from 'vitest';

import { runEngine, producedKinds, validateOutput } from '../src/sdk/run.ts';
import { createTestHost } from '../src/sdk/testkit.ts';
import {
  INPUT_REF,
  type EngineOutput,
  type RawChunk,
  type TransformEngine,
  type TransformInput,
} from '../src/sdk/types.ts';

const INPUT: TransformInput = { kind: 'domain', value: 'example.com', entityId: 'n1' };

const chunk = (payload: unknown, exhaustive?: boolean): RawChunk => ({
  at: '2026-08-19T10:00:00.000Z',
  payload,
  ...(exhaustive === undefined ? {} : { exhaustive }),
});

const okOutput = (values: readonly string[]): EngineOutput => ({
  entities: values.map((value) => ({ key: value, kind: 'ip', value, confidence: 0.9 })),
  relationships: values.map((value) => ({
    from: value,
    to: INPUT_REF,
    kind: 'derived_from',
    confidence: 0.9,
  })),
  evidence: values.map((value) => ({ entity: value, observedAt: '2026-08-19T10:00:00.000Z' })),
});

/** Minimal engine whose behaviour each test overrides. */
const makeEngine = (over: Partial<TransformEngine> = {}): TransformEngine => ({
  metadata: () => ({
    engine: 'test-engine',
    version: '1.0.0',
    capability: 'dns-discovery',
    provider: 'dns-google',
    permissions: ['network'],
    inputs: ['domain'],
    outputs: ['ip'],
  }),
  validateInput: () => ({ ok: true }),
  execute: async function* () {
    yield chunk({ ip: '1.1.1.1' });
  },
  normalize: (chunks) => okOutput(chunks.map((entry) => (entry.payload as { ip: string }).ip)),
  ...over,
});

describe('runEngine lifecycle', () => {
  it('runs validate → initialize → execute → normalize in order and reports completed', async () => {
    const calls: string[] = [];
    const engine = makeEngine({
      validateInput: () => {
        calls.push('validate');
        return { ok: true, normalizedValue: 'example.com' };
      },
      initialize: () => {
        calls.push('initialize');
      },
      execute: async function* () {
        calls.push('execute');
        yield chunk({ ip: '1.1.1.1' });
      },
      normalize: (chunks, input) => {
        calls.push(`normalize:${input.value}`);
        return okOutput(chunks.map((entry) => (entry.payload as { ip: string }).ip));
      },
      cleanup: () => {
        calls.push('cleanup');
      },
    });

    const outcome = await createTestHost().run(engine, INPUT);

    expect(calls).toEqual([
      'validate',
      'initialize',
      'execute',
      'cleanup',
      'normalize:example.com',
    ]);
    expect(outcome.status).toBe('completed');
    expect(outcome.entities).toHaveLength(1);
    expect(outcome.exhaustive).toBe(true);
    expect(outcome.violations).toEqual([]);
    expect(producedKinds(outcome)).toEqual(['ip']);
  });

  it('rejects invalid input before initialize and before any request', async () => {
    const initialize = vi.fn();
    const engine = makeEngine({
      initialize,
      validateInput: () => ({ ok: false, reason: 'not a domain' }),
    });
    const host = createTestHost();

    const outcome = await host.run(engine, { kind: 'email', value: 'x' });

    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toEqual({
      code: 'invalid-input',
      message: 'not a domain',
      retryable: false,
    });
    expect(initialize).not.toHaveBeenCalled();
    expect(host.calls).toEqual([]);
  });

  it('normalizes the input value the engine asked for', async () => {
    const engine = makeEngine({
      validateInput: () => ({ ok: true, normalizedValue: 'example.com' }),
      execute: async function* (input) {
        yield chunk({ ip: input.value });
      },
    });

    const outcome = await createTestHost().run(engine, { kind: 'domain', value: 'EXAMPLE.com.' });

    expect(outcome.entities[0]?.value).toBe('example.com');
  });

  it('marks the run partial and keeps chunks when the engine throws mid-stream', async () => {
    const engine = makeEngine({
      execute: async function* () {
        yield chunk({ ip: '1.1.1.1' });
        throw new Error('provider closed the connection');
      },
    });

    const outcome = await createTestHost().run(engine, INPUT);

    expect(outcome.status).toBe('partial');
    expect(outcome.entities).toHaveLength(1);
    expect(outcome.failure).toEqual({
      code: 'engine-error',
      message: 'provider closed the connection',
      retryable: true,
    });
  });

  it('fails without results when the engine throws immediately', async () => {
    const engine = makeEngine({
      execute: async function* () {
        throw new Error('boom');
        yield chunk({ ip: 'unreachable' });
      },
    });

    const outcome = await createTestHost().run(engine, INPUT);

    expect(outcome.status).toBe('failed');
    expect(outcome.chunks).toEqual([]);
  });

  it('keeps partial results on cancellation and always cleans up', async () => {
    const cleanup = vi.fn();
    const controller = new AbortController();
    const engine = makeEngine({
      cleanup,
      execute: async function* () {
        yield chunk({ ip: '1.1.1.1' });
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 50));
        yield chunk({ ip: '2.2.2.2' });
      },
    });

    const outcome = await createTestHost().run(engine, INPUT, { signal: controller.signal });

    expect(outcome.status).toBe('cancelled');
    expect(outcome.entities.map((entity) => entity.value)).toEqual(['1.1.1.1']);
    expect(outcome.exhaustive).toBe(false);
    expect(outcome.failure?.code).toBe('cancelled');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('stops a run that ignores its deadline and reports a retryable timeout', async () => {
    const engine = makeEngine({
      execute: async function* () {
        yield chunk({ ip: '1.1.1.1' });
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        yield chunk({ ip: '2.2.2.2' });
      },
    });

    const startedAt = Date.now();
    const outcome = await createTestHost().run(engine, INPUT, { deadlineMs: 20 });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(outcome.status).toBe('partial');
    expect(outcome.failure).toEqual({
      code: 'timeout',
      message: 'execute exceeded 20 ms',
      retryable: true,
    });
  });

  it('propagates `exhaustive: false` so the router may try a fallback', async () => {
    const engine = makeEngine({
      execute: async function* () {
        yield chunk({ ip: '1.1.1.1' }, false);
      },
    });

    expect((await createTestHost().run(engine, INPUT)).exhaustive).toBe(false);
  });

  it('truncates to maxResults and drops the relationships and evidence that went with it', async () => {
    const engine = makeEngine({
      execute: async function* () {
        yield chunk({ ip: '1.1.1.1' });
        yield chunk({ ip: '2.2.2.2' });
        yield chunk({ ip: '3.3.3.3' });
      },
    });

    const outcome = await createTestHost({ maxResults: 2 }).run(engine, INPUT);

    expect(outcome.truncated).toBe(true);
    expect(outcome.entities).toHaveLength(2);
    expect(outcome.relationships).toHaveLength(2);
    expect(outcome.evidence).toHaveLength(2);
  });

  it('fails the run when normalize throws', async () => {
    const engine = makeEngine({
      normalize: () => {
        throw new Error('bad payload');
      },
    });

    const outcome = await createTestHost().run(engine, INPUT);

    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('contract-violation');
    expect(outcome.violations).toEqual(['normalize threw']);
    expect(outcome.entities).toEqual([]);
  });

  it('discards output that violates the contract instead of proposing it', async () => {
    const engine = makeEngine({
      normalize: () => ({
        entities: [{ key: 'a', kind: 'ip', value: '1.1.1.1', confidence: 4 }],
        relationships: [{ from: 'a', to: 'ghost', kind: 'derived_from', confidence: 1 }],
        evidence: [],
      }),
    });

    const outcome = await createTestHost().run(engine, INPUT);

    expect(outcome.status).toBe('failed');
    expect(outcome.entities).toEqual([]);
    expect(outcome.violations).toEqual([
      'entity a confidence out of 0..1',
      'relationship a→ghost references an unknown entity',
      'entity a has no evidence',
    ]);
  });

  it('flags an engine that used the network without declaring the permission', async () => {
    const engine = makeEngine({
      metadata: () => ({
        engine: 'sneaky',
        version: '1.0.0',
        capability: 'dns-discovery',
        provider: 'dns-google',
        permissions: [],
        inputs: ['domain'],
        outputs: ['ip'],
      }),
      execute: async function* (_input, ctx) {
        await ctx.fetch('https://dns.google/resolve?name=example.com&type=A');
        yield chunk({ ip: '1.1.1.1' });
      },
    });
    const host = createTestHost({
      net: { 'https://dns.google/resolve?name=example.com&type=A': { status: 200, body: {} } },
    });

    const outcome = await host.run(engine, INPUT);

    expect(outcome.status).toBe('failed');
    expect(outcome.violations).toEqual([
      'engine used the network without declaring the `network` permission',
    ]);
  });

  it('exposes the credential vault and the log, and throws on an unmocked request', async () => {
    let seen: string | undefined;
    const engine = makeEngine({
      execute: async function* (_input, ctx) {
        seen = ctx.credential('API_KEY');
        ctx.log('info', 'looking up', { value: 'example.com' });
        await ctx.fetch('https://elsewhere.example/api');
        yield chunk({ ip: '1.1.1.1' });
      },
    });
    const host = createTestHost({ credentials: { API_KEY: 'secret' } });

    const outcome = await host.run(engine, INPUT);

    expect(seen).toBe('secret');
    expect(host.logs).toEqual([
      { level: 'info', message: 'looking up', fields: { value: 'example.com' } },
    ]);
    expect(outcome.failure?.message).toBe('unmocked request: https://elsewhere.example/api');
  });
});

describe('validateOutput', () => {
  it('accepts a well-formed output', () => {
    expect(validateOutput(okOutput(['1.1.1.1']), true, true)).toEqual([]);
  });

  it('names every structural problem it finds', () => {
    const violations = validateOutput(
      {
        entities: [
          { key: '', kind: 'ip', value: '1.1.1.1', confidence: 0.5 },
          { key: 'dup', kind: 'ip', value: '', confidence: 0.5 },
          { key: 'dup', kind: 'nonsense' as 'ip', value: '2.2.2.2', confidence: 0.5 },
        ],
        relationships: [{ from: 'dup', to: 'dup', kind: '', confidence: Number.NaN }],
        evidence: [{ entity: 'missing', observedAt: '2026-08-19T10:00:00.000Z' }],
      },
      false,
      false,
    );

    expect(violations).toEqual([
      'entity with an empty key',
      'entity dup has an empty value',
      'duplicate entity key: dup',
      'entity dup has unknown kind',
      'relationship dup→dup has no kind',
      'relationship dup→dup confidence out of 0..1',
      'evidence references an unknown entity: missing',
      'entity  has no evidence',
      'entity dup has no evidence',
    ]);
  });
});
