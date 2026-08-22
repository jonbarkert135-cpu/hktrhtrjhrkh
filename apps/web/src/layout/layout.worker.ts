/// <reference lib="webworker" />
/**
 * The layout worker (`05_CANVAS_ENGINE.md` §9: routing, layout, indexing and search run off the
 * main thread). Laying out 5,000 nodes takes hundreds of milliseconds — on the main thread that is
 * tens of dropped frames, which breaks N1 outright.
 *
 * Cancellation is cooperative: a `cancel` command sets a flag that the layout engine's checkpoints
 * observe, so an abandoned run stops within one checkpoint instead of running to completion.
 */

import { LayoutCancelledError, proposeLayout } from '@nexus/layout';

import {
  LayoutRequestSchema,
  type LayoutWorkerCommand,
  type LayoutWorkerEvent,
} from './protocol.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;

let cancelledRun: number | null = null;

function post(event: LayoutWorkerEvent): void {
  scope.postMessage(event);
}

export function handleCommand(
  command: LayoutWorkerCommand,
  emit: (event: LayoutWorkerEvent) => void,
): void {
  if (command.kind === 'cancel') {
    cancelledRun = command.runId;
    return;
  }
  const parsed = LayoutRequestSchema.safeParse(command.request);
  if (!parsed.success) {
    emit({ kind: 'error', runId: command.request.runId ?? 0, message: 'Invalid layout request' });
    return;
  }
  const request = parsed.data;
  try {
    let lastReport = 0;
    const diff = proposeLayout(
      request.graph,
      {
        algorithm: request.algorithm,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        ...(request.spacingX === undefined ? {} : { spacingX: request.spacingX }),
        ...(request.spacingY === undefined ? {} : { spacingY: request.spacingY }),
        ...(request.direction === undefined ? {} : { direction: request.direction }),
        ...(request.iterations === undefined ? {} : { iterations: request.iterations }),
      },
      {
        isCancelled: () => cancelledRun === request.runId,
        onProgress: (fraction) => {
          // One message per 5 % of progress: a message per checkpoint would cost more than the
          // layout itself on a big board.
          if (fraction - lastReport < 0.05 && fraction < 1) return;
          lastReport = fraction;
          emit({ kind: 'progress', runId: request.runId, fraction });
        },
      },
    );
    emit({ kind: 'done', runId: request.runId, diff });
  } catch (error) {
    if (error instanceof LayoutCancelledError) {
      emit({ kind: 'cancelled', runId: request.runId });
      return;
    }
    emit({
      kind: 'error',
      runId: request.runId,
      message: error instanceof Error ? error.message : 'Layout failed',
    });
  }
}

scope.addEventListener('message', (event: MessageEvent<LayoutWorkerCommand>) => {
  handleCommand(event.data, post);
});
