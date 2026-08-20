import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';

import { createSyncProvider, serverSyncLabel, type ProviderLike } from './syncProvider';

interface FakeProvider extends ProviderLike {
  emit: (event: string, data?: unknown) => void;
  connect: ReturnType<typeof vi.fn>;
}

function fakeProvider(): FakeProvider {
  const handlers = new Map<string, (data?: unknown) => void>();
  const fake: FakeProvider = {
    on: ((event: string, cb: (data?: unknown) => void) => {
      handlers.set(event, cb);
    }) as ProviderLike['on'],
    connect: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
    emit: (event: string, data?: unknown) => handlers.get(event)?.(data),
  };
  return fake;
}

function noopConnectivity() {
  return { isOnline: () => true, subscribe: () => () => undefined };
}

describe('createSyncProvider', () => {
  it('reaches connected once the provider opens', () => {
    const ref: { current: FakeProvider | null } = { current: null };
    const handle = createSyncProvider({
      url: 'ws://sync',
      boardId: 'b1',
      doc: new Y.Doc(),
      token: () => Promise.resolve('tok'),
      connectivity: noopConnectivity(),
      createProvider: () => {
        ref.current = fakeProvider();
        return ref.current;
      },
    });

    expect(handle.state()).toEqual({ kind: 'connecting' });
    ref.current?.emit('open');
    expect(handle.state()).toEqual({ kind: 'connected' });
    handle.destroy();
  });

  it('schedules a reconnect on close, except for a 4403 (revoked membership)', () => {
    vi.useFakeTimers();
    const ref: { current: FakeProvider | null } = { current: null };
    const handle = createSyncProvider({
      url: 'ws://sync',
      boardId: 'b1',
      doc: new Y.Doc(),
      token: () => Promise.resolve('tok'),
      connectivity: noopConnectivity(),
      random: () => 1,
      createProvider: () => {
        ref.current = fakeProvider();
        return ref.current;
      },
    });

    ref.current?.emit('close', { event: { code: 1001, reason: 'restart' } });
    expect(handle.state()).toEqual({ kind: 'reconnecting', attempt: 1 });
    vi.advanceTimersByTime(1_000);
    expect(ref.current?.connect).toHaveBeenCalledTimes(1);

    handle.destroy();
    vi.useRealTimers();
  });

  it('a 4403 close is terminal and does not reconnect', () => {
    vi.useFakeTimers();
    const ref: { current: FakeProvider | null } = { current: null };
    const handle = createSyncProvider({
      url: 'ws://sync',
      boardId: 'b1',
      doc: new Y.Doc(),
      token: () => Promise.resolve('tok'),
      connectivity: noopConnectivity(),
      createProvider: () => {
        ref.current = fakeProvider();
        return ref.current;
      },
    });

    ref.current?.emit('close', { event: { code: 4403, reason: 'revoked' } });
    expect(handle.state()).toEqual({ kind: 'closed', code: 4403, reason: 'revoked' });
    vi.advanceTimersByTime(60_000);
    expect(ref.current?.connect).not.toHaveBeenCalled();

    handle.destroy();
    vi.useRealTimers();
  });

  it('going offline overrides the connection state', () => {
    const listenerRef: { current: ((online: boolean) => void) | null } = { current: null };
    const handle = createSyncProvider({
      url: 'ws://sync',
      boardId: 'b1',
      doc: new Y.Doc(),
      token: () => Promise.resolve('tok'),
      connectivity: {
        isOnline: () => true,
        subscribe: (listener) => {
          listenerRef.current = listener;
          return () => undefined;
        },
      },
      createProvider: () => fakeProvider(),
    });

    listenerRef.current?.(false);
    expect(handle.state()).toEqual({ kind: 'offline' });
    handle.destroy();
  });
});

describe('serverSyncLabel', () => {
  it('maps every connection/local state pair to the six documented labels (P8 §6)', () => {
    expect(serverSyncLabel({ kind: 'offline' }, 'saving')).toBe('Offline');
    expect(serverSyncLabel({ kind: 'connected' }, 'offline')).toBe('Offline');
    expect(serverSyncLabel({ kind: 'read-only' }, 'saved')).toBe('Read-only');
    expect(serverSyncLabel({ kind: 'reconnecting', attempt: 1 }, 'saving')).toBe('Reconnecting…');
    expect(serverSyncLabel({ kind: 'reconnecting', attempt: 3 }, 'saving')).toBe(
      'Reconnecting… attempt 3',
    );
    expect(serverSyncLabel({ kind: 'connected' }, 'error')).toBe('Error');
    expect(serverSyncLabel({ kind: 'connected' }, 'saved')).toBe('Saved');
    expect(serverSyncLabel({ kind: 'connecting' }, 'saving')).toBe('Saving…');
  });
});
