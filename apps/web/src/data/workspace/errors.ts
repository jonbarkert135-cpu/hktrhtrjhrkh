/**
 * One place that turns a repository failure into a sentence, whichever implementation failed.
 *
 * A local failure already carries its own copy (`WorkspaceError`: quota, private browsing). A server
 * failure is a tRPC error whose code maps to the table in `lib/trpc.tsx`. Components must never have
 * to know which of the two they are looking at.
 */
import { errorMessage } from '../../lib/trpc.tsx';
import { WorkspaceError } from './types.ts';

export function workspaceErrorMessage(error: unknown): string {
  if (error instanceof WorkspaceError) return error.message;
  return errorMessage(error);
}
