/**
 * Testkit for engine authors (L4.2, brief §79–80). It is the same driver production uses
 * (`runEngine`), wired to a deterministic host: mocked fetch, fake vault, captured logs.
 * An unmocked URL throws, so a test can never accidentally hit the network.
 */

import type { ExecutionMode } from '../types.ts';
import { runEngine, type RunOptions, type RunOutcome } from './run.ts';
import type { HostFetch, LogLevel, TransformEngine, TransformInput } from './types.ts';

export interface MockResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface TestHostOptions {
  /** URL → response. Exact match; an unmocked URL throws. */
  readonly net?: Readonly<Record<string, MockResponse>>;
  readonly credentials?: Readonly<Record<string, string>>;
  readonly mode?: ExecutionMode;
  readonly maxResults?: number;
  readonly deadlineMs?: number;
}

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface TestHost {
  /** URLs the engine requested, in order. */
  readonly calls: readonly string[];
  readonly logs: readonly LogEntry[];
  readonly fetch: HostFetch;
  run(
    engine: TransformEngine,
    input: TransformInput,
    over?: Partial<Omit<RunOptions, 'input'>>,
  ): Promise<RunOutcome>;
}

export const createTestHost = (options: TestHostOptions = {}): TestHost => {
  const calls: string[] = [];
  const logs: LogEntry[] = [];
  const net = options.net ?? {};

  const fetch: HostFetch = (url) => {
    calls.push(url);
    const response = net[url];
    if (!response) return Promise.reject(new Error(`unmocked request: ${url}`));
    return Promise.resolve(response);
  };

  return {
    calls,
    logs,
    fetch,
    run: (engine, input, over) =>
      runEngine(engine, {
        input,
        mode: options.mode ?? 'zero-credential',
        maxResults: options.maxResults ?? 100,
        deadlineMs: options.deadlineMs ?? 5_000,
        fetch,
        credential: (key) => options.credentials?.[key],
        log: (level, message, fields) =>
          logs.push({ level, message, ...(fields ? { fields } : {}) }),
        ...over,
      }),
  };
};
