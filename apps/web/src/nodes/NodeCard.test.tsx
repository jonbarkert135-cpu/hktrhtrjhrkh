/**
 * The node-type × state matrix (18_TESTING.md §6, P4 §11). One test per type asserts the card
 * renders the fields that make that type worth having, plus the shared states.
 */

import { makeNode, type BoardNode } from '@nexus/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NodeCard } from './NodeCard.tsx';

const NOW_ISO = '2026-06-01T00:00:00.000Z';
const NOW = Date.parse(NOW_ISO);

const node = (
  type: string,
  data: Record<string, unknown> = {},
  extra: Partial<BoardNode> = {},
): BoardNode => ({
  ...makeNode({ id: 'n1', type, x: 0, y: 0, title: '', data }, NOW_ISO),
  ...extra,
});

describe('NodeCard per type', () => {
  it('website: host, description at detail zoom and the fetched footnote', () => {
    render(
      <NodeCard
        node={node('website', {
          url: 'https://example.com/a',
          description: 'A page about things',
          fetchedAt: new Date(NOW - 3 * 86_400_000).toISOString(),
        })}
        detailed
        now={NOW}
      />,
    );
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('A page about things')).toBeInTheDocument();
    expect(screen.getByText('Fetched 3 days ago')).toBeInTheDocument();
  });

  it('website: hides the description at compact zoom', () => {
    render(
      <NodeCard
        node={node('website', { url: 'https://example.com', description: 'Hidden' })}
        now={NOW}
      />,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('link: shows the label and the host', () => {
    render(
      <NodeCard node={node('link', { url: 'https://example.com/x', label: 'Docs' })} now={NOW} />,
    );
    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('text: shows a placeholder when empty', () => {
    render(<NodeCard node={node('text', { plain: '' })} now={NOW} />);
    expect(screen.getByText(/Write, paste/)).toBeInTheDocument();
  });

  it('note: shows the severity chip and the finding', () => {
    render(
      <NodeCard
        node={node('note', { plain: 'Reused password', severity: 'critical' })}
        now={NOW}
      />,
    );
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('Reused password')).toBeInTheDocument();
  });

  it('image: renders the placeholder, dimensions and the GPS flag', () => {
    render(
      <NodeCard
        node={node('image', {
          naturalWidth: 4000,
          naturalHeight: 3000,
          alt: 'A rooftop',
          exif: { hasGps: true, lat: 1, lon: 2, takenAt: null, camera: null },
        })}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('image-placeholder')).toHaveAccessibleName('A rooftop');
    expect(screen.getByText('4000 × 3000 · GPS')).toBeInTheDocument();
  });

  it('file: filename, type and a human size', () => {
    render(
      <NodeCard
        node={node('file', {
          filename: 'report.pdf',
          mime: 'application/pdf',
          size: 5_400_000,
          pages: 12,
        })}
        now={NOW}
      />,
    );
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('application/pdf · 5.4 MB · 12 pages')).toBeInTheDocument();
  });

  it('person: initials, name and username chips', () => {
    render(
      <NodeCard
        node={node('person', { displayName: 'Ada Lovelace', usernames: ['@ada', '@al'] })}
        now={NOW}
      />,
    );
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('@ada')).toBeInTheDocument();
  });

  it('repo: slug, language and stars', () => {
    render(
      <NodeCard
        node={node('repo', { owner: 'acme', name: 'tool', language: 'Python', stars: 42 })}
        now={NOW}
      />,
    );
    expect(screen.getByText('acme/tool')).toBeInTheDocument();
    expect(screen.getByText('Python · ★ 42')).toBeInTheDocument();
  });

  it('unknown: renders the payload read-only and names the type', () => {
    render(<NodeCard node={node('quantum-thing', { anything: [1, 2] })} now={NOW} />);
    expect(screen.getByText(/Unsupported type/)).toBeInTheDocument();
    expect(screen.getByTestId('unknown-payload').textContent).toContain('anything');
  });
});

describe('NodeCard states', () => {
  it('shows a skeleton while enrichment runs', () => {
    const loading = node(
      'website',
      { url: 'https://x.test' },
      {
        enrichment: { state: 'queued', jobId: null, attempts: 0, lastError: null, updatedAt: null },
      },
    );
    render(<NodeCard node={loading} now={NOW} />);
    expect(screen.getByTestId('card-skeleton')).toBeInTheDocument();
  });

  it('shows the error and a retry action', async () => {
    const onRetry = vi.fn();
    render(
      <NodeCard
        node={node('website', { url: 'https://x.test', status: 'failed', httpStatus: 500 })}
        onRetry={onRetry}
        now={NOW}
      />,
    );
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('n1');
  });

  it('marks stale data and locked nodes', () => {
    const stale = node(
      'website',
      {
        url: 'https://x.test',
        fetchedAt: new Date(NOW - 40 * 86_400_000).toISOString(),
      },
      { locked: true },
    );
    render(<NodeCard node={stale} now={NOW} />);
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('carries the state and the type on the element for the visual matrix', () => {
    render(<NodeCard node={node('note', { plain: 'x' })} context={{ selected: true }} now={NOW} />);
    const card = screen.getByTestId('node-card-n1');
    expect(card).toHaveAttribute('data-state', 'selected');
    expect(card).toHaveAttribute('data-node-type', 'note');
  });

  it('caps the visible tags and counts the rest', () => {
    render(
      <NodeCard
        node={node('note', { plain: 'x' }, { tags: ['a', 'b', 'c', 'd', 'e', 'f'] })}
        now={NOW}
      />,
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('offers duplicate and delete on the action rail', async () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    const onOpenInspector = vi.fn();
    render(
      <NodeCard
        node={node('note', { plain: 'x' })}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onOpenInspector={onOpenInspector}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate node' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete node' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(onDuplicate).toHaveBeenCalledWith('n1');
    expect(onDelete).toHaveBeenCalledWith('n1');
    expect(onOpenInspector).toHaveBeenCalledWith('n1');
  });

  it('names an untitled node by its type', () => {
    render(<NodeCard node={node('person', { displayName: '' })} now={NOW} />);
    expect(screen.getByRole('heading', { name: 'Untitled person' })).toBeInTheDocument();
  });
});

describe('NodeCard in-place editing', () => {
  it('offers Edit for text types and starts editing on double-click', async () => {
    const onBeginEdit = vi.fn();
    render(<NodeCard node={node('note', { plain: 'x' })} onBeginEdit={onBeginEdit} now={NOW} />);

    await userEvent.click(screen.getByRole('button', { name: 'Edit text' }));
    expect(onBeginEdit).toHaveBeenCalledWith('n1');

    await userEvent.dblClick(screen.getByRole('article'));
    expect(onBeginEdit).toHaveBeenCalledTimes(2);
  });

  it('offers no editing on a type without a text body, nor on a locked node', async () => {
    const onBeginEdit = vi.fn();
    const { rerender } = render(
      <NodeCard node={node('image', { alt: 'a' })} onBeginEdit={onBeginEdit} now={NOW} />,
    );
    expect(screen.queryByRole('button', { name: 'Edit text' })).not.toBeInTheDocument();

    rerender(
      <NodeCard
        node={node('note', { plain: 'x' }, { locked: true })}
        onBeginEdit={onBeginEdit}
        now={NOW}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Edit text' })).not.toBeInTheDocument();
    await userEvent.dblClick(screen.getByRole('article'));
    expect(onBeginEdit).not.toHaveBeenCalled();
  });

  it('shows the editor slot instead of the preview while editing', () => {
    render(
      <NodeCard
        node={node('note', { plain: 'preview text' })}
        onBeginEdit={vi.fn()}
        editorSlot={<div>editor here</div>}
        now={NOW}
      />,
    );
    expect(screen.getByTestId('card-editor-n1')).toBeInTheDocument();
    expect(screen.getByText('editor here')).toBeInTheDocument();
    expect(screen.queryByText('preview text')).not.toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'editing');
    // The rail must not offer a second way into a state the card is already in.
    expect(screen.queryByRole('button', { name: 'Edit text' })).not.toBeInTheDocument();
  });
});
