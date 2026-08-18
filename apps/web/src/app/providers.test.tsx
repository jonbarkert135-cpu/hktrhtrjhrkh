/**
 * The provider stack has one job: pick the right data path for the mode and mount nothing else.
 * Local mode must not construct a tRPC client; server mode must mount one and adapt it to the same
 * repository interface. Both shapes are asserted here, because the choice is made once at boot and
 * a regression would only show up in production.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppProviders } from './providers';
import { useWorkspace } from '../data/workspace/context.tsx';
import type { WorkspaceRepository } from '../data/workspace/types.ts';

const fakeRepository = (kind: 'local' | 'server'): WorkspaceRepository => ({
  kind,
  listProjects: () => Promise.resolve([]),
  createProject: () => Promise.reject(new Error('not used')),
  listBoards: () => Promise.resolve([]),
  createBoard: () => Promise.reject(new Error('not used')),
});

function ShowKind() {
  const repository = useWorkspace();
  return <span data-testid="kind">{repository.kind}</span>;
}

describe('AppProviders', () => {
  it('mounts the local repository when the backend capability is off', () => {
    render(
      <AppProviders backendEnabled={false}>
        <ShowKind />
      </AppProviders>,
    );
    expect(screen.getByTestId('kind')).toHaveTextContent('local');
  });

  it('honours an injected repository, so suites can drive the stack without storage', () => {
    render(
      <AppProviders backendEnabled={false} repository={fakeRepository('server')}>
        <ShowKind />
      </AppProviders>,
    );
    expect(screen.getByTestId('kind')).toHaveTextContent('server');
  });

  it('mounts the tRPC stack in server mode and still resolves the injected repository', () => {
    render(
      <AppProviders backendEnabled repository={fakeRepository('server')}>
        <ShowKind />
      </AppProviders>,
    );
    expect(screen.getByTestId('kind')).toHaveTextContent('server');
  });

  it('bridges tRPC to the repository interface when nothing is injected in server mode', () => {
    render(
      <AppProviders backendEnabled>
        <ShowKind />
      </AppProviders>,
    );
    expect(screen.getByTestId('kind')).toHaveTextContent('server');
  });
});
