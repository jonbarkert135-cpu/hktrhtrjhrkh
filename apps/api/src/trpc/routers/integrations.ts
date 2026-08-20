/**
 * `integrations.*` — the installed-manifest surface (10_INTEGRATIONS.md §10, first row).
 *
 * R1: this file contains no tool identifier. It lists whatever the registry holds, redacts what a
 * non-admin may not see (image digests), and reports manifests that failed validation so an
 * operator finds out from the product rather than from a support ticket.
 */

import { z } from 'zod';
import { builtinRegistry, type IntegrationManifest } from '@nexus/integrations';

import { orgProcedure, router } from '../trpc.ts';

/** Everything the picker and the consent dialog need, and nothing an attacker could use. */
function toDto(manifest: IntegrationManifest, includeDigest: boolean) {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    toolVersion: manifest.toolVersion,
    description: manifest.description,
    icon: manifest.icon,
    maturity: manifest.maturity,
    capabilities: manifest.capabilities,
    executionKind: manifest.execution.kind,
    inputs: manifest.inputs,
    permissions: manifest.permissions,
    rateLimits: manifest.rateLimits,
    costHints: manifest.costHints,
    risk: manifest.risk,
    consent: manifest.consent,
    limits: manifest.execution.limits,
    imageDigest:
      includeDigest && manifest.execution.kind === 'container' ? manifest.execution.digest : null,
  };
}

export const integrationsRouter = router({
  /** The picker's list. Present in every deployment: `expand-url` always exists (acceptance 1). */
  list: orgProcedure('viewer').query(({ ctx }) => {
    const registry = builtinRegistry();
    const includeDigest = ctx.role === 'admin' || ctx.role === 'owner';
    return {
      integrations: [...registry.entries.values()].map((entry) =>
        toDto(entry.manifest, includeDigest),
      ),
      // Surfaced in Admin → Integrations (§4.3); an invalid manifest never appears in the picker.
      rejected: includeDigest ? registry.rejected : [],
    };
  }),

  get: orgProcedure('viewer')
    .input(z.object({ integrationId: z.string().min(1).max(64) }))
    .query(({ ctx, input }) => {
      const entry = builtinRegistry().entries.get(input.integrationId);
      if (entry === undefined) return null;
      return toDto(entry.manifest, ctx.role === 'admin' || ctx.role === 'owner');
    }),

  /**
   * Which integrations accept the current selection. The UI uses this to decide between "Run
   * tool ▸" and the explicit "No tool accepts a <kind> node" affordance — never a silent hide.
   */
  accepts: orgProcedure('viewer')
    .input(
      z.object({
        selection: z
          .array(
            z.object({
              id: z.string(),
              kind: z.string(),
              label: z.string(),
            }),
          )
          .max(200),
      }),
    )
    .query(({ input }) => {
      const selection = input.selection.map((node) => ({
        id: node.id,
        kind: node.kind as never,
        label: node.label,
        props: {},
      }));
      return [...builtinRegistry().entries.values()]
        .filter((entry) => entry.inputAdapter.accepts(selection))
        .map((entry) => entry.manifest.id);
    }),
});
