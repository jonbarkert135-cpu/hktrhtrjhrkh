import { useState, type ReactNode } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink, TRPCClientError } from '@trpc/client';
import superjson from 'superjson';
import { create } from 'zustand';
import { Button, Dialog } from '@nexus/ui';
import type { AppRouter } from '@nexus/api';
import { API_URL } from './auth';

export const trpc = createTRPCReact<AppRouter>();

/** 03_UX.md §12.1: what happened · why · what to do. Never a bare code, never "Oops". */
const ERROR_COPY: Record<string, string> = {
  UNAUTHORIZED: 'Your session ended. Sign in again to continue — your work is not lost.',
  FORBIDDEN: "You don't have access to this. Ask a project admin for the Analyst role.",
  NOT_FOUND: "That item no longer exists. It may have been deleted or moved.",
  TIMEOUT: 'The server took too long to answer. Check your connection and try again.',
  CONFLICT: 'Someone else changed this first. Reload to see the current version.',
  TOO_MANY_REQUESTS: 'Too many attempts. Wait a minute, then try again.',
  BAD_REQUEST: "That request wasn't valid. Check the highlighted fields and try again.",
  PAYLOAD_TOO_LARGE: 'That file is too large. Try a smaller file.',
  INTERNAL_SERVER_ERROR: "The server couldn't complete that. Try again — nothing was changed.",
};

const FALLBACK_COPY = "That didn't work. Try again — nothing was changed.";

export function errorCode(error: unknown): string | undefined {
  if (error instanceof TRPCClientError) {
    const data: unknown = error.data;
    const code =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['code'] : null;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function errorMessage(error: unknown): string {
  const code = errorCode(error);
  return (code && ERROR_COPY[code]) ?? FALLBACK_COPY;
}

/** Session-expiry is app-wide state, not per-query: the route must survive it (P1 §8). */
export const useSessionExpired = create<{ expired: boolean; set: (v: boolean) => void }>((set) => ({
  expired: false,
  set: (expired) => set({ expired }),
}));

function ReloginDialog() {
  const expired = useSessionExpired((s) => s.expired);
  const dismiss = useSessionExpired((s) => s.set);
  return (
    <Dialog
      open={expired}
      onOpenChange={(open: boolean) => {
        if (!open) dismiss(false);
      }}
      title="Your session ended"
      description={ERROR_COPY['UNAUTHORIZED'] ?? FALLBACK_COPY}
    >
      <Button
        onClick={() => {
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.assign(`/login?next=${encodeURIComponent(next)}`);
        }}
      >
        Sign in again
      </Button>
    </Dialog>
  );
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (errorCode(error) === 'UNAUTHORIZED') useSessionExpired.getState().set(true);
          },
        }),
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  const [client] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${API_URL}/trpc`,
          transformer: superjson,
          // Cookie auth: the session cookie must ride along on every tRPC call.
          fetch: (input, init) =>
            fetch(input, { ...(init as RequestInit), credentials: 'include' }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReloginDialog />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
