/**
 * The regex corpus for the generic extractor (10_INTEGRATIONS.md §1.1, §8).
 *
 * A tool that reports structured records maps them declaratively through `entityMappings`; this
 * corpus is the fallback for the free-text case (a README, a WHOIS blob, a console log). Every
 * pattern is linear-time — no backreferences, no nested quantifiers — because it runs over
 * attacker-influenced tool output.
 */

import type { EntityKind } from '../manifest.ts';

export interface EntityPattern {
  readonly kind: EntityKind;
  readonly regex: RegExp;
  /** Base confidence for a heuristic match, before the manifest's own weighting (§8.4). */
  readonly confidence: number;
}

/** Ordered: the first pattern that claims a span wins, so a URL is not shredded into a domain. */
export const ENTITY_PATTERNS: readonly EntityPattern[] = [
  {
    kind: 'url',
    regex: /https?:\/\/[^\s"'<>()]{3,2000}/gi,
    confidence: 0.7,
  },
  {
    kind: 'email',
    regex: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}/g,
    confidence: 0.7,
  },
  {
    kind: 'ip',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    confidence: 0.65,
  },
  {
    kind: 'hash',
    regex: /\b[a-fA-F0-9]{32}\b|\b[a-fA-F0-9]{40}\b|\b[a-fA-F0-9]{64}\b|\b[a-fA-F0-9]{128}\b/g,
    confidence: 0.6,
  },
  {
    kind: 'domain',
    regex: /\b[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z]{2,24}){1,3}\b/g,
    confidence: 0.55,
  },
];

export interface PatternMatch {
  readonly kind: EntityKind;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

/**
 * Scans free text once per pattern and drops overlaps, longest span first. Bounded by `maxMatches`
 * so a 40 MB artifact cannot turn into a million candidate entities.
 */
export function scanText(text: string, maxMatches = 5_000): readonly PatternMatch[] {
  const found: PatternMatch[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      found.push({
        kind: pattern.kind,
        raw: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: pattern.confidence,
      });
      if (found.length >= maxMatches * 4) break;
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }

  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const claimed: PatternMatch[] = [];
  for (const candidate of found) {
    const overlaps = claimed.some(
      (other) => candidate.start < other.end && other.start < candidate.end,
    );
    if (overlaps) continue;
    claimed.push(candidate);
    if (claimed.length >= maxMatches) break;
  }
  return claimed.sort((a, b) => a.start - b.start);
}
