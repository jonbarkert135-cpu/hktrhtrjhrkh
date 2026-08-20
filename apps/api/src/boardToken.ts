/**
 * Board-token signing (P8 §5.1/§5.2/§9). The signing secret is read once from the validated
 * server env, same convention as `files/storage.ts` — routers depend on this module, tests
 * substitute it.
 */
import { signBoardToken, type BoardRole } from '@nexus/domain';
import { loadServerEnvFromProcess } from './env.ts';

let secret: string | null = null;

function getSecret(): string {
  secret ??= loadServerEnvFromProcess().SYNC_SHARED_SECRET;
  return secret;
}

export interface IssueBoardTokenInput {
  userId: string;
  boardId: string;
  role: BoardRole;
  name: string;
  color: string;
}

/** One board token per connection request; the sync service verifies it independently. */
export function issueBoardToken(input: IssueBoardTokenInput): string {
  return signBoardToken(input, getSecret());
}
