import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BlobPut } from './upload.ts';

const presign = vi.fn(() => Promise.resolve({ mode: 'single' as const, fileId: 'f1', url: 'u' }));
const complete = vi.fn(() => Promise.resolve({ state: 'ready', failure: null }));

vi.mock('../lib/trpc.tsx', () => ({
  trpc: {
    useUtils: () => ({
      client: { files: { presign: { mutate: presign }, complete: { mutate: complete } } },
    }),
  },
}));

const { useUpload } = await import('./useUpload.ts');

const png = (name: string, bytes: number): File => {
  const file = new File([new Uint8Array(0)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
};

function Harness({ put }: { put: BlobPut }) {
  const { tasks, upload, cancel, retry, busy } = useUpload({ projectId: 'p1', put });
  return (
    <div>
      <button type="button" onClick={() => upload([png('a.png', 8)])}>
        add
      </button>
      <button type="button" onClick={() => upload([png('huge.png', 26 * 1024 * 1024)])}>
        add huge
      </button>
      <button type="button" onClick={() => tasks[0] && cancel(tasks[0].id)}>
        cancel
      </button>
      <button type="button" onClick={() => tasks[0] && retry(tasks[0].id)}>
        retry
      </button>
      <p>busy: {String(busy)}</p>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            {task.filename} — {task.status} — {Math.round(task.progress * 100)}%
            {task.error === null ? '' : ` — ${task.error}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

const instantPut: BlobPut = ({ onProgress, blob }) => {
  onProgress(blob.size);
  return Promise.resolve();
};

describe('useUpload', () => {
  it('renders nothing at rest, then follows a queued file to done', async () => {
    presign.mockClear();
    complete.mockClear();
    render(<Harness put={instantPut} />);
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByText('busy: false')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'add' }));

    await waitFor(() => expect(screen.getByRole('listitem').textContent).toMatch(/done/));
    expect(screen.getByRole('listitem').textContent).toMatch(/a\.png — done — 100%/);
    expect(screen.getByText('busy: false')).toBeInTheDocument();
    expect(presign).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', filename: 'a.png', bytes: 8 }),
    );
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f1' }));
  });

  it('shows a locally rejected file with its reason and never calls the server', async () => {
    presign.mockClear();
    render(<Harness put={instantPut} />);

    await userEvent.click(screen.getByRole('button', { name: 'add huge' }));

    const item = await screen.findByRole('listitem');
    expect(item.textContent).toMatch(/huge\.png — failed/);
    expect(item.textContent).toMatch(/the limit is 25 MB/);
    expect(presign).not.toHaveBeenCalled();
  });

  it('cancels a task in flight and can retry it afterwards', async () => {
    let release: (() => void) | null = null;
    const held: BlobPut = ({ signal }) =>
      new Promise((_resolve, reject) => {
        release = () => reject(new DOMException('Cancelled', 'AbortError'));
        signal.addEventListener('abort', () => release?.());
      });
    render(<Harness put={held} />);

    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(screen.getByText('busy: true')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
    await waitFor(() => expect(screen.getByRole('listitem').textContent).toMatch(/cancelled/));

    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByRole('listitem').textContent).toMatch(/uploading/));
  });
});
