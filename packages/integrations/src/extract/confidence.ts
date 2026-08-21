/**
 * The confidence model (10_INTEGRATIONS.md §8.4).
 *
 *   confidence = clamp01(base × sourceWeight × evidenceFactor × versionFactor)
 *
 * The point of the model is that the number is *derived*, never typed in by a parser author, and
 * that corroboration is noisy-OR rather than addition — no chain of observations ever reaches
 * certainty, which is why the cap is 0.97.
 */

export const CONFIDENCE_CAP = 0.97;

export type ConfidenceSource = 'authoritative' | 'assertion' | 'heuristic' | 'inference';
export type EvidenceQuality = 'single' | 'corroborated' | 'ambiguous';
export type VersionDrift = 'exact' | 'patch' | 'minor' | 'major' | 'unknown';

export const SOURCE_WEIGHT: Readonly<Record<ConfidenceSource, number>> = {
  authoritative: 1.0,
  assertion: 0.85,
  heuristic: 0.7,
  inference: 0.55,
};

export const EVIDENCE_FACTOR: Readonly<Record<EvidenceQuality, number>> = {
  single: 1.0,
  corroborated: 1.1,
  ambiguous: 0.8,
};

/** §4.6: any minor/major drift multiplies every confidence by 0.8. */
export function versionFactor(drift: VersionDrift): number {
  return drift === 'exact' || drift === 'patch' ? 1.0 : 0.8;
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export interface ConfidenceInput {
  /** `entityMapping.baseConfidence`, 0.5–0.95 in practice. */
  readonly base: number;
  readonly source: ConfidenceSource;
  readonly evidence?: EvidenceQuality;
  readonly drift?: VersionDrift;
  /** `ParsedRecord.parserConfidence`. */
  readonly parserConfidence?: number;
}

export function computeConfidence(input: ConfidenceInput): number {
  const evidence = EVIDENCE_FACTOR[input.evidence ?? 'single'];
  const value =
    input.base *
    SOURCE_WEIGHT[input.source] *
    evidence *
    versionFactor(input.drift ?? 'exact') *
    (input.parserConfidence ?? 1);
  return clamp01(Math.min(value, CONFIDENCE_CAP));
}

/**
 * Corroboration at apply time: `1 - Π(1 - cᵢ)`, capped. Two independent 0.7 observations become
 * 0.91 — more than either alone, less than certainty.
 */
export function noisyOr(confidences: readonly number[]): number {
  if (confidences.length === 0) return 0;
  const product = confidences.reduce((acc, c) => acc * (1 - clamp01(c)), 1);
  return clamp01(Math.min(1 - product, CONFIDENCE_CAP));
}

export type ConfidenceBucket = 'high' | 'medium' | 'low';

/** Display buckets (§8.4). Cards show the bucket; the exact value lives in the inspector. */
export function bucketOf(confidence: number): ConfidenceBucket {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

/** §7.5 proposal defaults: `Low` items are never selected for the user. */
export const DEFAULT_SELECTION_THRESHOLD = 0.6;
export const HIGH_CONFIDENCE_THRESHOLD = 0.8;
