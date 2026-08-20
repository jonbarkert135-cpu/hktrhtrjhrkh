/**
 * The legal / ethical gate (10_INTEGRATIONS.md §12) as pure policy.
 *
 * R6 says nothing runs without an explicit, recorded, scoped consent. The enforcement points (API
 * before the run row is created, runner before the container starts) both call the functions here,
 * so "allowed" means exactly the same thing in both places — defence in depth, one definition.
 */

import { sha256Hex } from '@nexus/domain';

import { IntegrationError } from './errors.ts';
import type { IntegrationManifest, TargetScope } from './manifest.ts';
import type { ResolvedTarget } from './pipeline.ts';
import { isReservedIp } from './extract/normalizers.ts';

const encoder = new TextEncoder();

export function hashText(text: string): string {
  return sha256Hex(encoder.encode(text));
}

/** sha256 of the sorted, normalized target set: the identity a consent is bound to (§12.1). */
export function targetsHash(targets: readonly ResolvedTarget[]): string {
  const canonical = [...targets]
    .map((target) => `${target.kind}:${target.value}:${target.scope}`)
    .sort()
    .join('\n');
  return hashText(canonical);
}

/** Consent validity per risk label (§12.1): high = one run, medium = 24 h, low = 7 days. */
export function consentTtlMs(risk: IntegrationManifest['risk']['label']): number {
  if (risk === 'high') return 0;
  if (risk === 'medium') return 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

export interface ConsentRecord {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly integrationId: string;
  readonly scope: TargetScope;
  readonly targetsHash: string;
  readonly scopeTextHash: string;
  readonly acceptedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string | null;
  readonly usedAt?: string | null;
}

export interface ConsentCheck {
  readonly manifest: IntegrationManifest;
  readonly consent: ConsentRecord | null;
  readonly targets: readonly ResolvedTarget[];
  readonly projectId: string;
  readonly userId: string;
  readonly now: string;
}

/**
 * Throws the exact error the UI knows how to recover from: `CONSENT_REQUIRED` when there is none,
 * `CONSENT_EXPIRED` when the token aged out or the target set moved (the dialog reopens pre-filled;
 * there is no silent bypass).
 */
export function assertConsentValid(check: ConsentCheck): ConsentRecord {
  const { consent, manifest } = check;
  if (consent === null) {
    throw new IntegrationError('CONSENT_REQUIRED');
  }
  if (consent.integrationId !== manifest.id || consent.projectId !== check.projectId) {
    throw new IntegrationError('CONSENT_REQUIRED', {
      why: 'The stored authorization was given for a different tool or project.',
    });
  }
  if (consent.userId !== check.userId) {
    throw new IntegrationError('CONSENT_REQUIRED', {
      why: 'Authorization is personal; the person starting the run must give it.',
    });
  }
  if (consent.revokedAt != null) {
    throw new IntegrationError('CONSENT_EXPIRED', { why: 'This authorization was revoked.' });
  }
  if (Date.parse(consent.expiresAt) <= Date.parse(check.now)) {
    throw new IntegrationError('CONSENT_EXPIRED');
  }
  if (consent.scopeTextHash !== hashText(manifest.consent.scopeText)) {
    throw new IntegrationError('CONSENT_EXPIRED', {
      why: 'The authorization wording changed since you accepted it.',
    });
  }
  if (consent.targetsHash !== targetsHash(check.targets)) {
    throw new IntegrationError('CONSENT_EXPIRED', {
      why: 'The targets of this run differ from the ones you authorized.',
    });
  }
  // A high-risk consent is good for exactly one run (§12.1).
  if (manifest.risk.label === 'high' && consent.usedAt != null) {
    throw new IntegrationError('CONSENT_EXPIRED', {
      why: 'High-risk tools require a fresh authorization for every run.',
    });
  }
  return consent;
}

export interface TargetPolicy {
  /** Scopes an org admin enabled for this project; `third-party-host` is off unless listed. */
  readonly allowedScopes: readonly TargetScope[];
  /** Domains/IPs verified as owned by the org (DNS TXT or authorization letter). */
  readonly ownedAssets?: readonly string[];
  /** Operator-maintained `infra/policy/never-scan.txt`, non-overridable. */
  readonly neverScan?: readonly string[];
}

/** Capabilities that count as "scanning" for the `.gov`/`.mil` hard denylist (§12.2). */
const SCANNING_CAPABILITIES = new Set(['scan-domain', 'resolve-dns']);

/**
 * §12.2. Runs in the API before the run row exists and again in the runner before the container
 * starts; a mismatch at the second call is a `SANDBOX_VIOLATION`-class audit event.
 */
export function assertTargetsAllowed(
  manifest: IntegrationManifest,
  targets: readonly ResolvedTarget[],
  policy: TargetPolicy,
): void {
  const owned = new Set((policy.ownedAssets ?? []).map((asset) => asset.toLowerCase()));
  const neverScan = new Set((policy.neverScan ?? []).map((host) => host.toLowerCase()));
  const isScanner = manifest.capabilities.some((capability) =>
    SCANNING_CAPABILITIES.has(capability),
  );

  for (const target of targets) {
    if (!manifest.consent.allowedTargetScopes.includes(target.scope)) {
      throw new IntegrationError('TARGET_NOT_ALLOWED', {
        why: `This tool is not declared for ${target.scope} targets.`,
        detail: { scope: target.scope },
      });
    }
    if (!policy.allowedScopes.includes(target.scope)) {
      throw new IntegrationError('TARGET_NOT_ALLOWED', {
        why: `Your organization does not allow ${target.scope} targets for this project.`,
        detail: { scope: target.scope },
      });
    }

    const host = hostOf(target.value).toLowerCase();
    if (neverScan.has(host)) {
      throw new IntegrationError('TARGET_NOT_ALLOWED', {
        why: 'This host is on the operator denylist and can never be a target.',
      });
    }
    if (
      target.kind === 'ip' &&
      isReservedIp(target.value) &&
      !owned.has(target.value.toLowerCase())
    ) {
      throw new IntegrationError('TARGET_NOT_ALLOWED', {
        why: 'Private and reserved addresses are never valid targets.',
      });
    }
    if (isScanner && /\.(gov|mil)$/.test(host) && !owned.has(host)) {
      throw new IntegrationError('TARGET_NOT_ALLOWED', {
        why: 'Scanning-class tools may not target .gov or .mil hosts.',
      });
    }
  }
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

/** The four Redis token buckets checked before enqueue (§12.3). */
export function rateLimitKeys(input: {
  readonly userId: string;
  readonly orgId: string;
  readonly integrationId: string;
  readonly targets: readonly ResolvedTarget[];
}): {
  readonly user: string;
  readonly org: string;
  readonly targets: readonly string[];
  readonly concurrency: string;
} {
  return {
    user: `user:${input.userId}:${input.integrationId}`,
    org: `org:${input.orgId}:${input.integrationId}`,
    targets: input.targets.map(
      (target) => `target:${input.orgId}:${hashText(`${target.kind}:${target.value}`)}`,
    ),
    concurrency: `concurrency:${input.orgId}`,
  };
}

/** sha256 of the canonical JSON input: the re-run dedupe key (`integration_runs.input_hash`). */
export function inputHash(integrationId: string, input: unknown): string {
  return hashText(`${integrationId}\n${canonicalJson(input)}`);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Secrets never reach storage: `secretRef` inputs are replaced by their name before the row (§6.6). */
export function redactInput(
  manifest: IntegrationManifest,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const secretFields = new Set(
    manifest.inputs.filter((field) => field.type === 'secretRef').map((field) => field.name),
  );
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    redacted[key] = secretFields.has(key) ? { secretRef: String(value) } : value;
  }
  return redacted;
}
