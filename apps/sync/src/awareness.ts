/**
 * Re-exports the shared awareness shaping from `@nexus/domain` (`packages/domain/src/collab/
 * awareness.ts`) — both the sync service and the web client need identical caps/throttles/dedupe,
 * so the logic lives once, in the package both apps depend on.
 */
export {
  AWARENESS_PAYLOAD_CAP_BYTES,
  CURSOR_HZ,
  CURSOR_INTERVAL_MS,
  VIEWPORT_HZ,
  VIEWPORT_INTERVAL_MS,
  awarenessKey,
  createThrottle,
  dedupeAwarenessClients,
  distinctUsers,
  exceedsAwarenessCap,
  sanitizeAwareness,
} from '@nexus/domain';
export type { AwarenessState } from '@nexus/domain';
