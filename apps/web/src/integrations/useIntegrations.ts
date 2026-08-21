/**
 * The installed manifests, as the UI needs them.
 *
 * Read from the manifest registry rather than the API: the registry is the same list on both sides
 * (`integrations.list` builds its DTO from it), it costs no round trip, and the picker can render
 * before the first query resolves. R1 keeps this file out of `apps/web/src/app`.
 */

import { builtinRegistry, type IntegrationManifest } from '@nexus/integrations';

import type { IntegrationSummary } from './types.ts';

export function toSummary(manifest: IntegrationManifest): IntegrationSummary {
  const kinds = new Set<string>();
  for (const field of manifest.inputs) {
    if (field.from.source === 'selection') for (const kind of field.from.kinds) kinds.add(kind);
  }
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    executionKind: manifest.execution.kind,
    acceptsKinds: [...kinds],
    inputs: manifest.inputs.map((field) => ({
      name: field.name,
      fromSelection: field.from.source === 'selection',
      required: field.required,
    })),
    consent: { required: manifest.consent.required, scopeText: manifest.consent.scopeText },
    risk: { label: manifest.risk.label, reasons: manifest.risk.reasons },
  };
}

/** Stable for the lifetime of the tab: the registry is built from bundled manifests. */
export const installedIntegrations = (): IntegrationSummary[] =>
  [...builtinRegistry().entries.values()].map((entry) => toSummary(entry.manifest));
