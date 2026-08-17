import { createAuthClient } from 'better-auth/react';

export const API_URL: string =
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3001';

// The API mounts Better-Auth under /auth (apps/api/src/server.ts + `basePath: '/auth'` in
// apps/api/src/auth/index.ts). The client defaults to /api/auth, so without this the browser
// gets a 404 on every auth call and the UI reports "we couldn't reach the server".
export const AUTH_BASE_PATH = '/auth';

export const authClient = createAuthClient({ baseURL: API_URL, basePath: AUTH_BASE_PATH });

export const useSession = authClient.useSession;
