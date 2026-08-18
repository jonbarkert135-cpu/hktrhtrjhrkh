/**
 * The card state table (06_NODE_SYSTEM.md §3.2). Every state an analyst can see is asserted here,
 * because a card that silently renders "default" while an upload is failing is worse than an error.
 */

import { makeNode, type BoardNode } from '@nexus/domain';
import { describe, expect, it } from 'vitest';

import { STALE_AFTER_MS, cardErrorMessage, cardStateOf, relativeTime } from './cardState.ts';

const NOW_ISO = '2026-06-01T00:00:00.000Z';
const NOW = Date.parse(NOW_ISO);

const node = (
  type: string,
  data: Record<string, unknown> = {},
  extra: Partial<BoardNode> = {},
): BoardNode => ({
  ...makeNode({ id: 'n1', type, x: 0, y: 0, data }, NOW_ISO),
  ...extra,
});

describe('cardStateOf', () => {
  it('reports default for a complete node', () => {
    expect(cardStateOf(node('website', { url: 'https://example.com' }), { now: NOW })).toBe(
      'default',
    );
  });

  it('reports empty when a required field is missing', () => {
    expect(cardStateOf(node('website', { url: '' }), { now: NOW })).toBe('empty');
  });

  it('reports loading while enrichment runs', () => {
    const loading = node(
      'website',
      { url: 'https://example.com' },
      {
        enrichment: {
          state: 'running',
          jobId: null,
          attempts: 1,
          lastError: null,
          updatedAt: null,
        },
      },
    );
    expect(cardStateOf(loading, { now: NOW })).toBe('loading');
  });

  it('reports error for a failed fetch, a failed upload or an enrichment error', () => {
    expect(
      cardStateOf(node('website', { url: 'https://x.test', status: 'failed' }), { now: NOW }),
    ).toBe('error');
    expect(cardStateOf(node('file', { uploadState: 'failed' }), { now: NOW })).toBe('error');
    const failed = node(
      'note',
      {},
      {
        enrichment: {
          state: 'error',
          jobId: null,
          attempts: 3,
          lastError: 'boom',
          updatedAt: null,
        },
      },
    );
    expect(cardStateOf(failed, { now: NOW })).toBe('error');
  });

  it('reports stale past 30 days and not before', () => {
    const fresh = node('website', {
      url: 'https://x.test',
      fetchedAt: new Date(NOW - 1000).toISOString(),
    });
    const old = node('website', {
      url: 'https://x.test',
      fetchedAt: new Date(NOW - STALE_AFTER_MS - 1000).toISOString(),
    });
    expect(cardStateOf(fresh, { now: NOW })).toBe('default');
    expect(cardStateOf(old, { now: NOW })).toBe('stale');
  });

  it('ignores an unparseable fetchedAt instead of guessing', () => {
    expect(
      cardStateOf(node('website', { url: 'https://x.test', fetchedAt: 'yesterday' }), { now: NOW }),
    ).toBe('default');
  });

  it('lets interaction states win over data states', () => {
    const broken = node('website', { url: '' });
    expect(cardStateOf(broken, { selected: true, now: NOW })).toBe('selected');
    expect(cardStateOf(broken, { multiSelected: true, now: NOW })).toBe('multi-selected');
    expect(cardStateOf(broken, { dragging: true, now: NOW })).toBe('dragging');
    expect(cardStateOf(broken, { editing: true, now: NOW })).toBe('editing');
  });
});

describe('cardErrorMessage', () => {
  it('prefers the recorded error, then the upload error, then the HTTP status', () => {
    const enriched = node(
      'website',
      {},
      {
        enrichment: {
          state: 'error',
          jobId: null,
          attempts: 1,
          lastError: 'DNS failure',
          updatedAt: null,
        },
      },
    );
    expect(cardErrorMessage(enriched)).toBe('DNS failure');
    expect(cardErrorMessage(node('file', { uploadError: 'Upload cancelled' }))).toBe(
      'Upload cancelled',
    );
    expect(cardErrorMessage(node('website', { status: 'failed', httpStatus: 404 }))).toContain(
      'HTTP 404',
    );
    expect(cardErrorMessage(node('website', { status: 'failed' }))).toContain(
      'could not be fetched',
    );
    expect(cardErrorMessage(node('note'))).toBeNull();
  });
});

describe('relativeTime', () => {
  it('formats the distance in the largest sensible unit', () => {
    expect(relativeTime(new Date(NOW - 10_000).toISOString(), NOW)).toBe('just now');
    expect(relativeTime(new Date(NOW - 120_000).toISOString(), NOW)).toBe('2 minutes ago');
    expect(relativeTime(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe('1 hour ago');
    expect(relativeTime(new Date(NOW - 5 * 86_400_000).toISOString(), NOW)).toBe('5 days ago');
    expect(relativeTime(new Date(NOW - 400 * 86_400_000).toISOString(), NOW)).toBe('1 year ago');
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});
