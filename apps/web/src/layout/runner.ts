/**
 * Host side of the layout worker: one worker per board surface, one run at a time, every run
 * cancellable. If the platform has no `Worker` (jsdom in unit tests, a hardened browser), the same
 * work runs inline — the feature degrades to "a slower frame", never to "the button does nothing".
 */

import {
  LayoutCancelledError,
  proposeLayout,
  type LayoutDiff,
  type LayoutGraph,
} from '@nexus/layout';

import { toRequestGraph, type LayoutRequestMessage, type LayoutWorkerEvent } from './protocol.ts';

export type LayoutRunRequest = Omit<LayoutRequestMessage, 'runId' | 'graph'>;

export interface LayoutRunHandlers {
  onProgress?: (fraction: number) => void;
}

export interface LayoutRunner {
  /** Resolves with the diff, or `null` when the run was cancelled (by a newer run or by the user). */
  run(
    graph: LayoutGraph,
    request: LayoutRunRequest,
    handlers?: LayoutRunHandlers,
  ): Promise<LayoutDiff | null>;
  cancel(): void;
  dispose(): void;
  /** True when the work is actually off the main thread; the UI says so in the progress label. */
  readonly threaded: boolean;
}

export type WorkerFactory = () => Worker;

/** The production factory. Vite compiles the worker as its own module graph. */
export const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./layout.worker.ts', import.meta.url), {
    type: 'module',
    name: 'raven-layout',
  });

function optionsOf(request: LayoutRunRequest): Parameters<typeof proposeLayout>[1] {
  return {
    algorithm: request.algorithm,
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    ...(request.spacingX === undefined ? {} : { spacingX: request.spacingX }),
    ...(request.spacingY === undefined ? {} : { spacingY: request.spacingY }),
    ...(request.direction === undefined ? {} : { direction: request.direction }),
    ...(request.iterations === undefined ? {} : { iterations: request.iterations }),
  };
}

export function createLayoutRunner(
  factory: WorkerFactory | null = defaultWorkerFactory,
): LayoutRunner {
  let worker: Worker | null = null;
  let runId = 0;
  let cancelledRun: number | null = null;
  let settleCurrent: (() => void) | null = null;

  if (factory !== null && typeof Worker !== 'undefined') {
    try {
      worker = factory();
    } catch {
      // A CSP that forbids worker construction is a deployment choice, not a bug: run inline.
      worker = null;
    }
  }

  const runInline = (
    graph: LayoutGraph,
    request: LayoutRunRequest,
    id: number,
    handlers: LayoutRunHandlers,
  ): Promise<LayoutDiff | null> => {
    try {
      const diff = proposeLayout(graph, optionsOf(request), {
        isCancelled: () => cancelledRun === id,
        ...(handlers.onProgress === undefined ? {} : { onProgress: handlers.onProgress }),
      });
      return Promise.resolve(diff);
    } catch (error) {
      if (error instanceof LayoutCancelledError) return Promise.resolve(null);
      return Promise.reject(error instanceof Error ? error : new Error('Layout failed'));
    }
  };

  return {
    get threaded(): boolean {
      return worker !== null;
    },
    run(graph, request, handlers = {}) {
      // Starting a run implicitly abandons the previous one: the analyst changed their mind.
      settleCurrent?.();
      runId += 1;
      const id = runId;
      const live = worker;
      if (live === null) return runInline(graph, request, id, handlers);

      return new Promise<LayoutDiff | null>((resolve, reject) => {
        const finish = (): void => {
          live.removeEventListener('message', onMessage);
          live.removeEventListener('error', onError);
          settleCurrent = null;
        };
        const onMessage = (event: MessageEvent<LayoutWorkerEvent>): void => {
          const message = event.data;
          if (message.runId !== id) return;
          if (message.kind === 'progress') {
            handlers.onProgress?.(message.fraction);
            return;
          }
          finish();
          if (message.kind === 'done') resolve(message.diff);
          else if (message.kind === 'cancelled') resolve(null);
          else reject(new Error(message.message));
        };
        const onError = (): void => {
          finish();
          reject(new Error('The layout worker stopped unexpectedly.'));
        };
        settleCurrent = () => {
          finish();
          resolve(null);
        };
        live.addEventListener('message', onMessage);
        live.addEventListener('error', onError);
        live.postMessage({
          kind: 'run',
          request: { ...request, runId: id, graph: toRequestGraph(graph) },
        });
      });
    },
    cancel() {
      cancelledRun = runId;
      worker?.postMessage({ kind: 'cancel', runId });
      settleCurrent?.();
    },
    dispose() {
      settleCurrent?.();
      worker?.terminate();
      worker = null;
    },
  };
}
