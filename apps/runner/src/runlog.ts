/**
 * The structured run log writer (10_INTEGRATIONS.md §6.10).
 *
 * Every run — successful or not — gets the same eight-phase log, because "why did this produce
 * nothing?" is the question the product must always be able to answer. Sequence numbers are
 * allocated here so the log is totally ordered even when the runner and the worker both write.
 */

import type { IntegrationErrorPayload, RunLogger } from '@nexus/integrations';

export const RUN_PHASES = [
  'validate',
  'consent',
  'queue',
  'pull',
  'start',
  'exec',
  'egress',
  'collect',
  'parse',
  'map',
  'propose',
] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

export interface RunLogEntry {
  readonly runId: string;
  readonly seq: number;
  readonly at: string;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly phase: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export interface RunLogStore {
  append(entries: readonly RunLogEntry[]): Promise<void>;
  /** Next free sequence number for the run; 0 for a run with no entries yet. */
  nextSeq(runId: string): Promise<number>;
}

export interface RunLogPublisher {
  publish(
    runId: string,
    event: {
      t: 'log';
      seq: number;
      level: 'info' | 'warn' | 'error';
      phase: string;
      message: string;
    },
  ): void;
}

export interface RunLogWriterOptions {
  readonly runId: string;
  readonly store: RunLogStore;
  readonly publisher?: RunLogPublisher;
  readonly now?: () => string;
  /** Redacts secret values before anything is persisted (§6.6 point 5). */
  readonly scrub?: (text: string) => string;
  readonly flushEvery?: number;
}

/** Buffers entries and flushes in batches; a chatty tool must not become a write per line. */
export class RunLogWriter implements RunLogger {
  private buffer: RunLogEntry[] = [];
  private seq = 0;
  private started = false;

  private readonly options: RunLogWriterOptions;

  constructor(options: RunLogWriterOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.seq = await this.options.store.nextSeq(this.options.runId);
    this.started = true;
  }

  log(entry: {
    level: 'debug' | 'info' | 'warn' | 'error';
    phase: string;
    message: string;
    data?: Record<string, unknown>;
  }): void {
    const scrub = this.options.scrub ?? ((text: string) => text);
    const record: RunLogEntry = {
      runId: this.options.runId,
      seq: this.seq++,
      at: (this.options.now ?? (() => new Date().toISOString()))(),
      level: entry.level,
      phase: entry.phase,
      message: scrub(entry.message).slice(0, 2000),
      ...(entry.data === undefined ? {} : { data: entry.data }),
    };
    this.buffer.push(record);
    if (entry.level !== 'debug') {
      this.options.publisher?.publish(this.options.runId, {
        t: 'log',
        seq: record.seq,
        level: entry.level,
        phase: entry.phase,
        message: record.message,
      });
    }
    if (this.buffer.length >= (this.options.flushEvery ?? 20)) void this.flush();
  }

  error(phase: RunPhase, payload: IntegrationErrorPayload): void {
    this.log({
      level: 'error',
      phase,
      message: `${payload.code}: ${payload.what} ${payload.why}`,
      data: { code: payload.code, retryable: payload.retryable },
    });
  }

  async flush(): Promise<void> {
    if (!this.started) await this.start();
    if (this.buffer.length === 0) return;
    const pending = this.buffer;
    this.buffer = [];
    await this.options.store.append(pending);
  }
}
