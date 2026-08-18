/**
 * The provider stack, chosen once by capability.
 *
 * Local mode (the default) mounts a plain react-query client and the IndexedDB repository: the
 * bundle never constructs a tRPC client, never reads an API url and therefore cannot make a request
 * even by accident. Server mode mounts `TRPCProvider` and adapts it to the same repository
 * interface. Everything below this component is identical in both shapes.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { createLocalWorkspaceRepository } from '../data/workspace/local.ts';
import { TrpcWorkspaceBridge, WorkspaceProvider } from '../data/workspace/context.tsx';
import type { WorkspaceRepository } from '../data/workspace/types.ts';
import { TRPCProvider } from '../lib/trpc.tsx';
import { capabilities } from '../mode/appMode.ts';
import { BoardStatusProvider } from './shell/boardStatus.tsx';

export interface AppProvidersProps {
  children: ReactNode;
  /** Test seam. Production resolves the repository from the mode. */
  repository?: WorkspaceRepository | undefined;
  /** Test seam, so a suite can exercise the server stack without a server-mode build. */
  backendEnabled?: boolean | undefined;
}

export function AppProviders({ children, repository, backendEnabled }: AppProvidersProps) {
  const backend = backendEnabled ?? capabilities.backend;
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  const [localRepository] = useState<WorkspaceRepository>(
    () => repository ?? createLocalWorkspaceRepository(),
  );

  if (backend) {
    return (
      <TRPCProvider>
        <BoardStatusProvider>
          {repository === undefined ? (
            <TrpcWorkspaceBridge>{children}</TrpcWorkspaceBridge>
          ) : (
            <WorkspaceProvider repository={repository}>{children}</WorkspaceProvider>
          )}
        </BoardStatusProvider>
      </TRPCProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BoardStatusProvider>
        <WorkspaceProvider repository={localRepository}>{children}</WorkspaceProvider>
      </BoardStatusProvider>
    </QueryClientProvider>
  );
}
