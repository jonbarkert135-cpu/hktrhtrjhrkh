/**
 * `onAuthenticate` for the Hocuspocus server (P8 §1/§2/§9). Token signing/verification is shared,
 * pure logic in `@nexus/domain` (`packages/domain/src/auth/boardToken.ts`) — this module is the
 * thin adapter that turns a verify result into the decision Hocuspocus needs (accept + context,
 * or a specific close code) and is the seam `apps/sync/test/auth.test.ts` exercises.
 */

import { isReadOnlyRole, parseRoom, verifyBoardToken, type BoardRole } from '@nexus/domain';

export {
  BOARD_ROLES,
  BOARD_TOKEN_TTL_MS,
  isReadOnlyRole,
  parseRoom,
  signBoardToken,
  verifyBoardToken,
} from '@nexus/domain';
export type { BoardRole, BoardTokenPayload, VerifyResult } from '@nexus/domain';

export interface AuthenticateArgs {
  token: string;
  documentName: string;
}

export interface AuthenticatedContext {
  userId: string;
  boardId: string;
  role: BoardRole;
  name: string;
  color: string;
  readOnly: boolean;
}

export class AuthError extends Error {
  readonly code: 4401 | 4403;
  constructor(code: 4401 | 4403, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * The pure decision behind Hocuspocus's `onAuthenticate` (P8 §1/§9): 4401 for anything the token
 * itself is wrong about (unsigned, expired, malformed), 4403 for a token that is valid but scoped
 * to a different board. Kept independent of the Hocuspocus types so it is testable without
 * booting a server (P8 §11 `apps/sync/test/auth.test.ts`).
 */
export function authenticateBoardToken(
  args: AuthenticateArgs,
  secret: string,
): AuthenticatedContext {
  const boardId = parseRoom(args.documentName);
  if (!boardId) throw new AuthError(4401, 'Malformed room name.');

  const result = verifyBoardToken(args.token, secret, boardId);
  if (!result.ok) {
    if (result.reason === 'wrong-board') {
      throw new AuthError(4403, 'This token does not authorize this board.');
    }
    throw new AuthError(4401, `Board token rejected: ${result.reason}.`);
  }
  const { payload } = result;
  return {
    userId: payload.userId,
    boardId: payload.boardId,
    role: payload.role,
    name: payload.name,
    color: payload.color,
    readOnly: isReadOnlyRole(payload.role),
  };
}
