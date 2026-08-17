import { createAuthClient } from 'better-auth/react';

export const API_URL: string =
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3001';

export const authClient = createAuthClient({ baseURL: API_URL });

export const useSession = authClient.useSession;
