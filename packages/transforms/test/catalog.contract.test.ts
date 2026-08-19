/**
 * The shipped catalogue must be internally consistent *and* consistent with the two documents an
 * analyst reads (docs/ecosystem/*). Documentation drift in a catalogue of credential statuses is
 * not cosmetic: it is how someone ends up sending a selector to a provider they thought was local.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENGINES, PROVIDERS, TRANSFORMS, createCatalogRegistry } from '../src/catalog/index.ts';
import { DEFAULT_BUDGET, actionsFor, expand } from '../src/planner.ts';
import { routeTransform } from '../src/router.ts';
import type { ExecutionMode } from '../src/types.ts';

const docs = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../docs/ecosystem/${name}`, import.meta.url)), 'utf8');

const registry = createCatalogRegistry();

const context = (mode: ExecutionMode, configured: readonly string[] = []) => ({
  mode,
  configuredProviders: new Set(configured),
  grantedPermissions: new Set([
    'network',
    'filesystem',
    'subprocess',
    'credentials',
    'browser',
  ] as const),
  budget: DEFAULT_BUDGET,
});

describe('shipped catalogue', () => {
  it('validates with zero issues', () => {
    expect(registry.validate()).toEqual([]);
  });

  it('has a transform for every engine capability that is not terminal', () => {
    const covered = new Set(TRANSFORMS.map((transform) => transform.capability));
    const orphans = ENGINES.filter((engine) => !engine.terminal && !covered.has(engine.capability));
    expect(orphans.map((engine) => engine.id)).toEqual([]);
  });

  it('references only providers that exist, and uses every provider it declares', () => {
    const used = new Set(ENGINES.map((engine) => engine.provider));
    expect(PROVIDERS.filter((provider) => !used.has(provider.id)).map((p) => p.id)).toEqual([]);
  });

  it('documents every shipped transform in TRANSFORM_CATALOG.md', () => {
    const text = docs('TRANSFORM_CATALOG.md');
    const undocumented = TRANSFORMS.filter(
      (transform) => !text.includes(`\`${transform.id}\``),
    ).map((transform) => transform.id);
    expect(undocumented).toEqual([]);
  });

  it('documents every provider in PROVIDER_CATALOG.md', () => {
    const text = docs('PROVIDER_CATALOG.md').toLowerCase();
    const undocumented = PROVIDERS.filter(
      (provider) =>
        !text.includes(provider.name.toLowerCase()) && !text.includes(provider.id.toLowerCase()),
    ).map((provider) => provider.id);
    expect(undocumented).toEqual([]);
  });

  it('declares credentials consistently with the credential class', () => {
    for (const provider of PROVIDERS) {
      if (provider.credentialClass === 'A') expect(provider.credentials).not.toBe('required');
      if (provider.credentialClass === 'D') expect(provider.pricing).toBe('paid');
    }
  });

  it('carries an attribution wherever the data licence demands one', () => {
    for (const provider of PROVIDERS) {
      if (provider.dataLicence) expect(provider.attribution).toBeTruthy();
    }
  });

  it('keeps every core transform reachable without credentials', () => {
    const core = TRANSFORMS.filter((transform) => transform.priority === 'core');
    const unreachable = core
      .map((transform) => routeTransform(registry, transform, context('zero-credential')))
      .filter((routed) => routed.reason !== undefined)
      .map((routed) => routed.transform.id);
    expect(unreachable).toEqual([]);
  });

  it('offers no network engine at all in strict local mode', () => {
    for (const transform of TRANSFORMS) {
      const routed = routeTransform(registry, transform, context('strict-local'));
      const executing = routed.chain.filter((entry) => !entry.engine.terminal);
      expect(executing.every((entry) => entry.engine.dataFlow === 'local')).toBe(true);
    }
  });

  it('has a verification date for every provider and none in the future', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const provider of PROVIDERS) {
      expect(provider.lastVerified <= today).toBe(true);
    }
  });
});

describe('acceptance: expand a username with no credentials (brief §110)', () => {
  const plan = expand(registry, 'username', context('zero-credential'), 2);

  it('plans real work without a single API key', () => {
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.credentialsNeeded).toEqual([]);
  });

  it('discloses that data leaves the machine and which providers see it', () => {
    expect(plan.requiresNetwork).toBe(true);
    expect(plan.providersUsed).toContain('sherlock');
  });

  it('explains everything it left out', () => {
    for (const exclusion of plan.excluded) {
      expect(exclusion.reason).toBeTruthy();
    }
    expect(plan.excluded.some((entry) => entry.reason === 'blocked-by-mode')).toBe(true);
  });

  it('offers a short, ranked menu for the same entity', () => {
    const actions = actionsFor(registry, 'username', context('zero-credential'));
    expect(actions.length).toBeLessThanOrEqual(7);
    // Ranked by score, so the keyless GitHub call can outrank the slower profile sweep — both must
    // be offered, and neither may need a credential in this mode.
    expect(actions.map((action) => action.transform.id)).toEqual(
      expect.arrayContaining(['username-to-profiles', 'username-to-repositories']),
    );
    const usable = actions.filter((action) => action.reason === undefined);
    expect(usable.map((action) => action.transform.id)).toEqual(
      expect.arrayContaining(['username-to-profiles', 'username-to-repositories']),
    );
  });

  it('chains onward from a discovered domain', () => {
    const onward = actionsFor(registry, 'domain', context('zero-credential'));
    expect(onward.map((action) => action.transform.id)).toContain('domain-to-dns');
  });
});
