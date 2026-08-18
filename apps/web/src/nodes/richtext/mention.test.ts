/**
 * The mention popup is plain DOM driven by TipTap's suggestion utility, so it is tested the same
 * way it runs: drive the render callbacks, then assert on the DOM and on what was inserted.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createMentionPopup,
  mentionSuggestion,
  MENTION_LIMIT,
  type MentionCandidate,
} from './mention.ts';

const candidate = (id: string, title: string): MentionCandidate => ({
  id,
  title,
  typeLabel: 'Person',
});

const handlers = (items: MentionCandidate[]) => ({
  search: vi.fn((query: string) =>
    items.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())),
  ),
  onAccept: vi.fn(),
});

/** The subset of the suggestion props the renderer touches. */
const props = (items: MentionCandidate[], command = vi.fn()) =>
  ({ items, command }) as unknown as Parameters<
    ReturnType<ReturnType<typeof mentionSuggestion>['render'] & (() => never)>['onStart']
  >[0];

describe('createMentionPopup', () => {
  it('renders one option per candidate and marks the highlighted one', () => {
    const popup = createMentionPopup(() => undefined);
    popup.render([candidate('n1', 'Ada'), candidate('n2', 'Grace')], 1);

    const options = popup.element.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute('aria-selected')).toBe('false');
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    expect(options[1]?.textContent).toContain('Grace');
  });

  it('names untitled nodes by type instead of showing an empty row', () => {
    const popup = createMentionPopup(() => undefined);
    popup.render([candidate('n1', '')], 0);
    expect(popup.element.textContent).toContain('Untitled person');
  });

  it('explains the empty state instead of showing a blank box', () => {
    const popup = createMentionPopup(() => undefined);
    popup.render([], 0);
    expect(popup.element.textContent).toContain('No node matches');
  });

  it('picks on mousedown, before the editor can lose its selection', () => {
    const picked = vi.fn();
    const popup = createMentionPopup(picked);
    popup.render([candidate('n1', 'Ada')], 0);
    const option = popup.element.querySelector('[role="option"]');
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }));
  });
});

describe('mentionSuggestion', () => {
  const mountPoint = (): HTMLElement => {
    const host = document.createElement('div');
    document.body.append(host);
    return host;
  };

  it('caps the candidate list so the popup stays scannable', () => {
    const items = Array.from({ length: 20 }, (_, index) => candidate(`n${String(index)}`, 'Ada'));
    const suggestion = mentionSuggestion(handlers(items), mountPoint);
    expect(suggestion.items?.({ query: 'ada' } as never)).toHaveLength(MENTION_LIMIT);
  });

  it('moves the highlight with the arrow keys and wraps around', () => {
    const host = mountPoint();
    const renderer = mentionSuggestion(handlers([]), () => host).render?.();
    const list = [candidate('n1', 'Ada'), candidate('n2', 'Grace')];
    renderer?.onStart?.(props(list));

    const selected = (): string | null =>
      host.querySelector('[aria-selected="true"]')?.textContent ?? null;
    expect(selected()).toContain('Ada');

    const key = (name: string): boolean =>
      renderer?.onKeyDown?.({ event: new KeyboardEvent('keydown', { key: name }) } as never) ??
      false;

    expect(key('ArrowDown')).toBe(true);
    expect(selected()).toContain('Grace');
    expect(key('ArrowDown')).toBe(true);
    expect(selected()).toContain('Ada');
    expect(key('ArrowUp')).toBe(true);
    expect(selected()).toContain('Grace');
    expect(key('a')).toBe(false);
    renderer?.onExit?.(props(list));
  });

  it('inserts the highlighted candidate on Enter and closes on Escape', () => {
    const host = mountPoint();
    const command = vi.fn();
    const renderer = mentionSuggestion(handlers([]), () => host).render?.();
    renderer?.onStart?.(props([candidate('n1', 'Ada')], command));

    expect(
      renderer?.onKeyDown?.({ event: new KeyboardEvent('keydown', { key: 'Enter' }) } as never),
    ).toBe(true);
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }));

    expect(
      renderer?.onKeyDown?.({ event: new KeyboardEvent('keydown', { key: 'Escape' }) } as never),
    ).toBe(true);
    expect(host.querySelector('.nx-mention-popup')).toBeNull();
  });

  it('refuses Enter when there is nothing to insert', () => {
    const host = mountPoint();
    const renderer = mentionSuggestion(handlers([]), () => host).render?.();
    renderer?.onStart?.(props([]));
    expect(
      renderer?.onKeyDown?.({ event: new KeyboardEvent('keydown', { key: 'Enter' }) } as never),
    ).toBe(false);
    expect(
      renderer?.onKeyDown?.({ event: new KeyboardEvent('keydown', { key: 'ArrowDown' }) } as never),
    ).toBe(true);
    renderer?.onUpdate?.(props([candidate('n1', 'Ada')]));
    expect(host.textContent).toContain('Ada');
    renderer?.onExit?.(props([]));
    expect(host.querySelector('.nx-mention-popup')).toBeNull();
  });
});
