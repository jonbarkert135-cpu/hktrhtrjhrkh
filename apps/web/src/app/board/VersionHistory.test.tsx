import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SnapshotStore, SnapshotSummary } from '../../data/snapshots';
import { VersionHistory, relativeTime } from './VersionHistory';

const T = 1_800_000_000_000;

const summary = (
  id: string,
  createdAt: number,
  reason: SnapshotSummary['reason'] = 'auto',
): SnapshotSummary => ({
  id,
  boardId: 'b_1',
  createdAt,
  nodeCount: 3,
  edgeCount: 1,
  reason,
});

function storeWith(records: SnapshotSummary[], failing = false): SnapshotStore {
  return {
    list: () => (failing ? Promise.reject(new Error('nope')) : Promise.resolve(records)),
    save: () => Promise.resolve(),
    load: () => Promise.resolve(null),
    prune: () => Promise.resolve(0),
  };
}

describe('relativeTime', () => {
  it('formats seconds, minutes, hours and days', () => {
    expect(relativeTime(T - 5_000, T)).toBe('5 s ago');
    expect(relativeTime(T - 300_000, T)).toBe('5 min ago');
    expect(relativeTime(T - 7_200_000, T)).toBe('2 h ago');
    expect(relativeTime(T - 172_800_000, T)).toBe('2 d ago');
  });
});

describe('<VersionHistory>', () => {
  const view = (props: Partial<React.ComponentProps<typeof VersionHistory>> = {}) => {
    const onPreview = vi.fn();
    const onRestore = vi.fn();
    render(
      <VersionHistory
        open
        boardId="b_1"
        store={storeWith([summary('s1', T - 10_000), summary('s2', T - 600_000, 'checkpoint')])}
        onOpenChange={vi.fn()}
        onPreview={onPreview}
        onRestore={onRestore}
        now={T}
        {...props}
      />,
    );
    return { onPreview, onRestore };
  };

  it('lists snapshots with relative time and counts', async () => {
    view();
    expect(await screen.findByText(/10 s ago — 3 nodes, 1 edges/)).toBeInTheDocument();
    expect(screen.getByText(/10 min ago .*\(checkpoint\)/)).toBeInTheDocument();
  });

  it('previews and restores a version', async () => {
    const { onPreview, onRestore } = view();
    const previews = await screen.findAllByRole('button', { name: 'Preview' });
    fireEvent.click(previews[0] as HTMLElement);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Restore this version' })[0] as HTMLElement,
    );
    expect(onPreview).toHaveBeenCalledWith('s1');
    expect(onRestore).toHaveBeenCalledWith('s1');
  });

  it('shows the preview banner while a version is being previewed', async () => {
    view({ previewingId: 's1' });
    expect(await screen.findByText(/You are previewing a version/)).toBeInTheDocument();
  });

  it('explains an empty history', async () => {
    view({ store: storeWith([]) });
    expect(await screen.findByText(/No snapshots yet/)).toBeInTheDocument();
  });

  it('reports a store that cannot be read', async () => {
    view({ store: storeWith([], true) });
    await waitFor(() =>
      expect(screen.getByText(/could not be read from this device/)).toBeInTheDocument(),
    );
  });
});
