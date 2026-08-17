/**
 * Canvas text measurement, ellipsis and the LRU that keeps both cheap (05_CANVAS_ENGINE.md §6.9,
 * 20_ROADMAP P2 §7 "measured-width cache keyed by font+text.slice(0,64)").
 *
 * Pure arithmetic over an injected measure function: no DOM, no module-scope state.
 */

import { MAX_CANVAS_TEXT, TEXT_CACHE_LIMIT } from '../constants';

export const ELLIPSIS = '\u2026';

/** Insertion-ordered Map = LRU: re-inserting on read moves the key to the young end. */
export interface Lru<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly size: number;
  clear(): void;
}

export function createLru<V>(limit: number): Lru<V> {
  const map = new Map<string, V>();
  return {
    get(key: string): V | undefined {
      const hit = map.get(key);
      if (hit === undefined) return undefined;
      map.delete(key);
      map.set(key, hit);
      return hit;
    },
    set(key: string, value: V): void {
      if (map.delete(key) === false && map.size >= limit) {
        const oldest = map.keys().next();
        if (oldest.done === false) map.delete(oldest.value);
      }
      map.set(key, value);
    },
    get size(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
  };
}

/** 09 §9: canvas text is hard-capped so a pathological title cannot make a frame O(length). */
export function truncateHard(value: string): string {
  return value.length > MAX_CANVAS_TEXT ? sliceSafe(value, MAX_CANVAS_TEXT) : value;
}

/** Never cuts a surrogate pair in half (emoji titles would render as a replacement glyph). */
export function sliceSafe(value: string, end: number): string {
  if (end >= value.length) return value;
  if (end <= 0) return '';
  const last = value.charCodeAt(end - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? end - 1 : end;
  return value.slice(0, cut);
}

export type MeasureFn = (value: string, font: string) => number;

export interface TextCache {
  /** Width in CSS px of `value` at `font`, memoized. */
  width(measure: MeasureFn, value: string, font: string): number;
  /** `value` hard-truncated, then ellipsized to fit `maxWidth`; memoized. */
  fit(measure: MeasureFn, value: string, font: string, maxWidth: number): string;
  readonly size: number;
  clear(): void;
}

export function createTextCache(limit: number = TEXT_CACHE_LIMIT): TextCache {
  const widths = createLru<number>(limit);
  const fitted = createLru<string>(limit);

  const measureCached = (measure: MeasureFn, value: string, font: string): number => {
    const key = cacheKey(font, value);
    const hit = widths.get(key);
    if (hit !== undefined) return hit;
    const w = measure(value, font);
    widths.set(key, w);
    return w;
  };

  return {
    width: measureCached,
    fit(measure: MeasureFn, value: string, font: string, maxWidth: number): string {
      const source = truncateHard(value);
      const key = `${Math.round(maxWidth)}|${cacheKey(font, source)}`;
      const hit = fitted.get(key);
      if (hit !== undefined) return hit;
      const out = ellipsize(
        (v: string) => measureCached(measure, v, font),
        source,
        Math.max(0, maxWidth),
      );
      fitted.set(key, out);
      return out;
    },
    get size(): number {
      return widths.size + fitted.size;
    },
    clear(): void {
      widths.clear();
      fitted.clear();
    },
  };
}

/**
 * Binary search for the longest prefix whose ellipsized form fits — ⌈log2 n⌉ measurements, each of
 * which is itself memoized (05 §6.9).
 */
export function ellipsize(
  width: (value: string) => number,
  value: string,
  maxWidth: number,
): string {
  if (value.length === 0 || width(value) <= maxWidth) return value;
  if (width(ELLIPSIS) > maxWidth) return '';
  let low = 0;
  let high = value.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (width(sliceSafe(value, mid) + ELLIPSIS) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? ELLIPSIS : sliceSafe(value, low) + ELLIPSIS;
}

/** 20_ROADMAP P2 §7: the key is font + the first 64 chars, so long titles cannot bloat the map. */
function cacheKey(font: string, value: string): string {
  return `${font}|${value.length}|${sliceSafe(value, 64)}`;
}
