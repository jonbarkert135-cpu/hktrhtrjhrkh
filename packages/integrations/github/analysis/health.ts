/**
 * Step I — license and maintenance risk (11_GITHUB.md §5.8).
 *
 * The score is deterministic and every term is reported as a signal, so a user can see *why* a
 * repository is called `at-risk` instead of trusting a number. We never assert a license we could
 * not match.
 */

export interface HealthInput {
  pushedAt: string | null;
  latestReleaseAt: string | null;
  archived: boolean;
  stars: number;
  openIssues: number;
  contributorsCount: number | null;
  licenseSpdxId: string | null;
  licenseFileText: string | null;
}

export interface Health {
  license: {
    spdxId: string | null;
    method: 'api' | 'text-match' | 'none';
    permissive: boolean | null;
  };
  maintenanceScore: number;
  maintenanceBand: 'healthy' | 'watch' | 'at-risk' | 'unmaintained';
  signals: { signal: string; value: string; points: number }[];
  archived: boolean;
  contributorsCount: number | null;
}

const PERMISSIVE = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Unlicense',
  '0BSD',
]);

/** First-2 KB marker match against a small SPDX table (§5.8); unmatched stays `null`. */
const LICENSE_MARKERS: ReadonlyArray<[string, RegExp]> = [
  ['MIT', /permission is hereby granted, free of charge/i],
  ['Apache-2.0', /apache license,?\s+version 2\.0/i],
  ['GPL-3.0', /gnu general public license\s+version 3/i],
  ['AGPL-3.0', /gnu affero general public license/i],
  ['BSD-3-Clause', /neither the name of .* nor the names of its contributors/i],
  ['ISC', /permission to use, copy, modify, and\/or distribute this software/i],
  ['MPL-2.0', /mozilla public license,? v(?:ersion )?2\.0/i],
];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const days = (from: string | null, nowMs: number): number | null => {
  if (from === null) return null;
  const at = Date.parse(from);
  return Number.isNaN(at) ? null : (nowMs - at) / 86_400_000;
};

export function detectLicense(input: HealthInput): Health['license'] {
  const spdx = input.licenseSpdxId;
  if (spdx !== null && spdx !== 'NOASSERTION') {
    return { spdxId: spdx, method: 'api', permissive: PERMISSIVE.has(spdx) };
  }
  const head = (input.licenseFileText ?? '').slice(0, 2048);
  if (head.trim() !== '') {
    const guess = LICENSE_MARKERS.find(([, marker]) => marker.test(head))?.[0] ?? null;
    if (guess !== null)
      return { spdxId: guess, method: 'text-match', permissive: PERMISSIVE.has(guess) };
  }
  return { spdxId: null, method: 'none', permissive: null };
}

export function scoreMaintenance(input: HealthInput, nowMs: number): Health {
  const signals: Health['signals'] = [];
  const add = (signal: string, value: string, points: number): number => {
    signals.push({ signal, value, points: Number(points.toFixed(2)) });
    return points;
  };

  const daysSincePush = days(input.pushedAt, nowMs);
  const daysSinceRelease = days(input.latestReleaseAt, nowMs) ?? daysSincePush;

  let score = 0;
  score += add(
    'staleness',
    daysSincePush === null ? 'unknown' : `${Math.round(daysSincePush)}d since push`,
    daysSincePush === null ? 0 : clamp((daysSincePush / 30) * 8, 0, 40),
  );
  score += add(
    'release cadence',
    daysSinceRelease === null ? 'no releases' : `${Math.round(daysSinceRelease)}d since release`,
    daysSinceRelease === null ? 0 : clamp((daysSinceRelease / 90) * 6, 0, 20),
  );
  score += add('archived', String(input.archived), input.archived ? 25 : 0);
  const contributors = input.contributorsCount;
  score += add(
    'contributors',
    contributors === null ? 'unknown' : String(contributors),
    contributors === null ? 0 : contributors <= 1 ? 10 : contributors <= 3 ? 5 : 0,
  );
  const license = detectLicense(input);
  score += add('license', license.spdxId ?? 'none', license.spdxId === null ? 10 : 0);
  score += add(
    'popularity',
    `${input.stars} stars`,
    -clamp(Math.log10(Math.max(1, input.stars)) * 2, 0, 8),
  );

  const maintenanceScore = clamp(Math.round(score), 0, 100);
  const maintenanceBand =
    maintenanceScore < 20
      ? 'healthy'
      : maintenanceScore < 45
        ? 'watch'
        : maintenanceScore < 70
          ? 'at-risk'
          : 'unmaintained';

  return {
    license,
    maintenanceScore,
    maintenanceBand,
    signals,
    archived: input.archived,
    contributorsCount: input.contributorsCount,
  };
}
