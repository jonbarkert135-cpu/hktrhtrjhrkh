/**
 * The `builtin` execution layer (10_INTEGRATIONS.md §3.3).
 *
 * Runs in the runner process, without a container, but through the *same* job protocol, wall-clock
 * timeout and cancellation path as a container run — which is exactly what makes `expand-url` a
 * proof of the framework rather than a special case beside it.
 */

import {
  payloadFor,
  toErrorPayload,
  type ExecutionLayer,
  type ExecutionRequest,
  type RawRunResult,
} from '@nexus/integrations';

import { requireBuiltin, type BuiltinContext } from './builtin-registry.ts';
import type { CancelWatch } from '../cancel.ts';
import { collectArtifact, type ArtifactSink } from '../artifacts.ts';

export interface BuiltinExecutorDeps {
  readonly sink: ArtifactSink;
  readonly bucket: string;
  readonly orgId: string;
  readonly transport: BuiltinContext['transport'];
  readonly resolve: BuiltinContext['resolve'];
  readonly watch: CancelWatch;
  readonly now?: () => string;
  readonly log?: (message: string) => void;
}

export function createBuiltinExecutor(deps: BuiltinExecutorDeps): ExecutionLayer {
  const now = deps.now ?? (() => new Date().toISOString());
  const controllers = new Map<string, AbortController>();

  return {
    async execute(request: ExecutionRequest): Promise<RawRunResult> {
      const startedAt = now();
      const start = Date.now();
      const controller = new AbortController();
      controllers.set(request.runId, controller);

      const timeout = setTimeout(() => controller.abort(), request.limits.wallClockMs);
      void deps.watch.signal.then(() => controller.abort());

      const finish = (
        status: RawRunResult['status'],
        extra: Partial<RawRunResult> = {},
      ): RawRunResult => ({
        runId: request.runId,
        status,
        exitCode: status === 'succeeded' ? 0 : 1,
        startedAt,
        finishedAt: now(),
        durationMs: Date.now() - start,
        artifacts: [],
        stats: { bytesOut: 0, egressRequests: 0, egressDenied: 0, peakMemMiB: 0 },
        ...extra,
      });

      try {
        const module = requireBuiltin(
          request.manifest.execution.kind === 'builtin' ? request.manifest.execution.module : '',
        );
        const body = await module.run(request.input as Record<string, unknown>, {
          runId: request.runId,
          signal: controller.signal,
          transport: deps.transport,
          resolve: deps.resolve,
          now,
          log: deps.log ?? (() => undefined),
        });

        const output =
          request.manifest.outputs.find((o) => o.primary) ?? request.manifest.outputs[0];
        const bytes = new TextEncoder().encode(body);
        const collected = await collectArtifact(deps.sink, bytes, {
          orgId: deps.orgId,
          runId: request.runId,
          name: `${output?.name ?? 'result'}.json`,
          kind: 'json',
          maxBytes: output?.maxBytes ?? request.limits.maxOutputBytes,
          runBudget: request.limits.maxOutputBytes,
          bucket: deps.bucket,
        });

        return finish(collected.ref.truncated ? 'partial' : 'succeeded', {
          artifacts: [collected.ref],
          stats: {
            bytesOut: collected.bytesWritten,
            egressRequests: 1,
            egressDenied: 0,
            peakMemMiB: 0,
            itemsFound: collected.ref.truncated ? 0 : 1,
          },
        });
      } catch (error) {
        if (deps.watch.cancelled())
          return finish('cancelled', { error: payloadFor('CANCELLED', { runId: request.runId }) });
        if (controller.signal.aborted) {
          return finish('timed_out', { error: payloadFor('TIMEOUT', { runId: request.runId }) });
        }
        return finish('failed', { error: toErrorPayload(error, request.runId) });
      } finally {
        clearTimeout(timeout);
        controllers.delete(request.runId);
      }
    },

    cancel(runId: string): Promise<void> {
      controllers.get(runId)?.abort();
      return Promise.resolve();
    },
  };
}
