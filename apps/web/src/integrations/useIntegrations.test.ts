/** The picker's list comes from the manifest registry, not the network (see `useIntegrations`). */

import { builtinRegistry } from '@nexus/integrations';
import { describe, expect, it } from 'vitest';

import { installedIntegrations, toSummary } from './useIntegrations.ts';

describe('installedIntegrations', () => {
  it('summarises every registered manifest', () => {
    const summaries = installedIntegrations();
    expect(summaries.length).toBe(builtinRegistry().entries.size);
    expect(summaries.every((s) => s.name !== '' && s.consent.scopeText !== '')).toBe(true);
  });

  it('collects the entity kinds a manifest takes from the selection', () => {
    const manifest = [...builtinRegistry().entries.values()][0]!.manifest;
    const summary = toSummary(manifest);
    expect(summary.inputs.length).toBe(manifest.inputs.length);
    expect(summary.executionKind).toBe(manifest.execution.kind);
  });
});
