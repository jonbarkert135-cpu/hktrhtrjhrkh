/**
 * Conformance harness (L4.2, brief §81). An engine is installable only if this passes: it checks
 * the input schema, the output schema, entity and relationship schemas, errors, the deadline,
 * cancellation, purity of `normalize` and that no permission is used undeclared.
 *
 * It is a plain async function returning a report, so it runs in CI, in a vitest test, or in the
 * developer-mode UI (L4.6) without dragging a test runner into the package.
 */

import type { EngineManifest, EntityKind } from '../types.ts';
import { createTestHost, type MockResponse } from './testkit.ts';
import type { EngineContext, TransformEngine, TransformInput } from './types.ts';

export interface ConformanceFixture {
  readonly name: string;
  readonly input: TransformInput;
  readonly net?: Readonly<Record<string, MockResponse>>;
  readonly credentials?: Readonly<Record<string, string>>;
  readonly expect?: {
    readonly minEntities?: number;
    readonly kinds?: readonly EntityKind[];
  };
}

export interface ConformanceOptions {
  /** The manifest the engine ships with; metadata must agree with it. */
  readonly manifest: EngineManifest;
  /** At least one fixture that produces results. */
  readonly fixtures: readonly ConformanceFixture[];
  /** Inputs the engine must reject without doing any I/O. */
  readonly invalidInputs: readonly TransformInput[];
}

export interface ConformanceCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface ConformanceReport {
  readonly engine: string;
  readonly passed: boolean;
  readonly checks: readonly ConformanceCheck[];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** A slow engine is not a broken engine, but it must react to an abort within this window. */
const GRACE_MS = 200;

/**
 * How long `execute` takes to settle after the signal is aborted. The driver stops waiting
 * immediately, so only a direct measurement catches an engine that never checks `ctx.signal` —
 * exactly the engine that keeps a socket open after the analyst pressed Stop.
 */
const abortLatencyMs = async (
  engine: TransformEngine,
  fixture: ConformanceFixture,
  fetch: EngineContext['fetch'],
): Promise<number> => {
  const controller = new AbortController();
  const stream = engine.execute(fixture.input, {
    mode: 'zero-credential',
    signal: controller.signal,
    deadlineMs: 5_000,
    maxResults: 100,
    credential: (key) => fixture.credentials?.[key],
    fetch,
    log: () => undefined,
  });
  const iterator = stream[Symbol.asyncIterator]();
  let abortedAt = Date.now();
  try {
    await iterator.next();
    controller.abort();
    abortedAt = Date.now();
    await iterator.next();
  } catch {
    // A rejection right after the abort is a correct way to stop.
  } finally {
    void iterator.return?.().catch(() => undefined);
  }
  return Date.now() - abortedAt;
};

export const runConformance = async (
  engine: TransformEngine,
  options: ConformanceOptions,
): Promise<ConformanceReport> => {
  const checks: ConformanceCheck[] = [];
  const add = (id: string, ok: boolean, detail?: string): void => {
    checks.push({ id, ok, ...(detail !== undefined ? { detail } : {}) });
  };

  const meta = engine.metadata();
  const m = options.manifest;
  add(
    'metadata-matches-manifest',
    meta.engine === m.id &&
      meta.version === m.version &&
      meta.capability === m.capability &&
      meta.provider === m.provider &&
      sameSet([...meta.permissions], [...m.permissions]),
    `metadata ${meta.engine}@${meta.version} vs manifest ${m.id}@${m.version}`,
  );
  add(
    'declares-input-and-output-kinds',
    meta.inputs.length > 0 && meta.outputs.length > 0,
    `${meta.inputs.length} inputs, ${meta.outputs.length} outputs`,
  );
  add('has-fixtures', options.fixtures.length > 0 && options.invalidInputs.length > 0);

  for (const bad of options.invalidInputs) {
    const host = createTestHost();
    const verdict = engine.validateInput(bad);
    const outcome = await host.run(engine, bad);
    add(
      `rejects-invalid-input:${bad.kind}/${bad.value}`,
      verdict.ok === false &&
        typeof verdict.reason === 'string' &&
        verdict.reason.length > 0 &&
        outcome.status === 'failed' &&
        outcome.failure?.code === 'invalid-input' &&
        host.calls.length === 0,
      `verdict=${String(verdict.ok)} status=${outcome.status} calls=${host.calls.length}`,
    );
  }

  const allowedKinds = new Set<string>(meta.outputs);

  for (const fixture of options.fixtures) {
    const label = fixture.name;
    const host = createTestHost({
      ...(fixture.net ? { net: fixture.net } : {}),
      ...(fixture.credentials ? { credentials: fixture.credentials } : {}),
    });
    add(`accepts-fixture-input:${label}`, engine.validateInput(fixture.input).ok);

    const outcome = await host.run(engine, fixture.input);
    add(
      `fixture-completes:${label}`,
      outcome.status === 'completed' && outcome.violations.length === 0,
      `status=${outcome.status} violations=${outcome.violations.join('; ')}`,
    );
    add(
      `fixture-yields-results:${label}`,
      outcome.entities.length >= (fixture.expect?.minEntities ?? 1),
      `${outcome.entities.length} entities`,
    );
    add(
      `outputs-within-declared-kinds:${label}`,
      outcome.entities.every((entity) => allowedKinds.has(entity.kind)),
      [...new Set(outcome.entities.map((entity) => entity.kind))].join(', '),
    );
    if (fixture.expect?.kinds) {
      const produced = new Set(outcome.entities.map((entity) => entity.kind));
      add(
        `produces-expected-kinds:${label}`,
        fixture.expect.kinds.every((kind) => produced.has(kind)),
        [...produced].join(', '),
      );
    }

    const first = engine.normalize(outcome.chunks, fixture.input);
    const second = engine.normalize(outcome.chunks, fixture.input);
    add(
      `normalize-is-pure:${label}`,
      JSON.stringify(first) === JSON.stringify(second),
      'same chunks must produce the same graph',
    );

    const capped = await createTestHost({
      ...(fixture.net ? { net: fixture.net } : {}),
      maxResults: 1,
    }).run(engine, fixture.input);
    add(
      `respects-max-results:${label}`,
      capped.entities.length <= 1 && capped.truncated === outcome.entities.length > 1,
      `${capped.entities.length} entities, truncated=${String(capped.truncated)}`,
    );

    const controller = new AbortController();
    controller.abort();
    const cancelled = await host.run(engine, fixture.input, { signal: controller.signal });
    add(
      `honours-cancellation:${label}`,
      cancelled.status === 'cancelled' && cancelled.failure?.code === 'cancelled',
      `status=${cancelled.status}`,
    );

    const latency = await abortLatencyMs(engine, fixture, host.fetch);
    add(
      `reacts-to-abort:${label}`,
      latency <= GRACE_MS,
      `execute settled ${latency} ms after abort`,
    );
  }

  if (engine.healthCheck) {
    const host = createTestHost({ net: options.fixtures[0]?.net ?? {} });
    let detail = '';
    let ok = false;
    try {
      const health = await engine.healthCheck({
        mode: 'zero-credential',
        signal: new AbortController().signal,
        deadlineMs: 2_000,
        maxResults: 1,
        credential: () => undefined,
        fetch: host.fetch,
        log: () => undefined,
      });
      ok = typeof health.ok === 'boolean' && !Number.isNaN(Date.parse(health.checkedAt));
      detail = `ok=${String(health.ok)} checkedAt=${health.checkedAt}`;
    } catch (error) {
      detail = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    add('health-check-shape', ok, detail);
  }

  return { engine: meta.engine, passed: checks.every((check) => check.ok), checks };
};

/** One-line summary of the failures, for a CI log or a PR comment. */
export const formatConformance = (report: ConformanceReport): string =>
  report.passed
    ? `${report.engine}: ${report.checks.length} checks passed`
    : `${report.engine}: ${report.checks
        .filter((check) => !check.ok)
        .map((check) => `${check.id} (${check.detail ?? 'failed'})`)
        .join(', ')}`;
