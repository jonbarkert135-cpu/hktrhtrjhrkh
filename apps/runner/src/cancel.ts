/**
 * Cooperative and hard cancellation (10_INTEGRATIONS.md §6.7).
 *
 * The Redis key is authoritative, not the socket: a UI that lost its connection must still be able
 * to stop a run. The runner both subscribes (fast path) and polls every 500 ms (reliable path), and
 * a cancelled run still collects whatever the tool already wrote.
 */

import { cancelKey } from './protocol.ts';

export const CANCEL_POLL_MS = 500;

export interface CancelBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  subscribe(channel: string, listener: (message: string) => void): Promise<() => Promise<void>>;
}

export interface CancelWatch {
  readonly cancelled: () => boolean;
  stop(): Promise<void>;
  /** Resolves as soon as cancellation is observed; never rejects. */
  readonly signal: Promise<void>;
}

export async function requestCancel(
  backend: CancelBackend,
  runId: string,
  wallClockMs: number,
): Promise<void> {
  await backend.set(cancelKey(runId), '1', wallClockMs);
}

export async function watchCancel(
  backend: CancelBackend,
  runId: string,
  options: { pollMs?: number } = {},
): Promise<CancelWatch> {
  let cancelled = false;
  let resolveSignal: () => void = () => undefined;
  const signal = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });

  const trip = (): void => {
    if (cancelled) return;
    cancelled = true;
    resolveSignal();
  };

  const unsubscribe = await backend.subscribe(`run:${runId}`, (message) => {
    if (message.includes('cancel')) trip();
  });

  const timer = setInterval(() => {
    void backend.get(cancelKey(runId)).then((value) => {
      if (value !== null) trip();
    });
  }, options.pollMs ?? CANCEL_POLL_MS);
  // A cancellation poll must never hold the process open by itself.
  timer.unref?.();

  return {
    cancelled: () => cancelled,
    signal,
    async stop() {
      clearInterval(timer);
      await unsubscribe();
    },
  };
}
