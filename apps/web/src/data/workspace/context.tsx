/**
 * Wiring for the workspace repository: one provider, four hooks, no component that knows whether
 * the data came from IndexedDB or from the API.
 *
 * `WorkspaceProvider` is the seam. In local mode `main.tsx` hands it the IndexedDB implementation;
 * in server mode `TrpcWorkspaceBridge` builds the tRPC-backed one. Tests hand it a fake.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { trpc } from '../../lib/trpc.tsx';
import { createServerWorkspaceRepository } from './server.ts';
import type { WorkspaceBoard, WorkspaceProject, WorkspaceRepository } from './types.ts';

const WorkspaceContext = createContext<WorkspaceRepository | null>(null);

export function WorkspaceProvider({
  repository,
  children,
}: {
  repository: WorkspaceRepository;
  children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={repository}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceRepository {
  const repository = useContext(WorkspaceContext);
  if (repository === null) {
    throw new Error('useWorkspace must be used inside a <WorkspaceProvider>.');
  }
  return repository;
}

/**
 * Server mode only: adapts the tRPC client to the repository interface. Mounted inside
 * `TRPCProvider`, so it may use `useUtils()`; local mode never renders it, which is what keeps the
 * API router out of the local runtime path.
 */
export function TrpcWorkspaceBridge({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const repository = useMemo(
    () =>
      createServerWorkspaceRepository({
        listProjects: (input) => utils.client.project.list.query(input),
        createProject: (input) => utils.client.project.create.mutate(input),
        listBoards: (input) => utils.client.board.list.query(input),
        createBoard: (input) => utils.client.board.create.mutate(input),
      }),
    [utils],
  );
  return <WorkspaceProvider repository={repository}>{children}</WorkspaceProvider>;
}

export const projectsKey = ['workspace', 'projects'] as const;
export const boardsKey = (projectId: string) => ['workspace', 'boards', projectId] as const;

export function useProjects(): UseQueryResult<WorkspaceProject[]> {
  const repository = useWorkspace();
  return useQuery({ queryKey: projectsKey, queryFn: () => repository.listProjects() });
}

export function useCreateProject(onCreated: (project: WorkspaceProject) => void | Promise<void>) {
  const repository = useWorkspace();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => repository.createProject(input),
    onSuccess: async (project) => {
      await client.invalidateQueries({ queryKey: projectsKey });
      await onCreated(project);
    },
  });
}

export function useBoards(projectId: string): UseQueryResult<WorkspaceBoard[]> {
  const repository = useWorkspace();
  return useQuery({
    queryKey: boardsKey(projectId),
    queryFn: () => repository.listBoards(projectId),
    enabled: projectId !== '',
  });
}

export function useCreateBoard(
  projectId: string,
  onCreated: (board: WorkspaceBoard) => void | Promise<void>,
) {
  const repository = useWorkspace();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string }) => repository.createBoard({ projectId, ...input }),
    onSuccess: async (board) => {
      await client.invalidateQueries({ queryKey: boardsKey(projectId) });
      await onCreated(board);
    },
  });
}
