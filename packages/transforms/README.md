# @nexus/transforms

The transform layer: what an analyst can _do_ to an entity, which engine will do it, and under
which mode, permissions and budget. Design: `RAVEN-SPEC/21_TRANSFORM_SYSTEM.md`. Research behind
the shipped catalogue: `docs/ecosystem/`.

Pure logic, no I/O. Execution lives in the Runner (`RAVEN-SPEC/10_INTEGRATIONS.md`); this package
only decides and explains, which is why a plan can always be shown before anything runs.

```ts
import { createCatalogRegistry, actionsFor, expand, DEFAULT_BUDGET } from '@nexus/transforms';

const registry = createCatalogRegistry();
const ctx = {
  mode: 'zero-credential',
  configuredProviders: new Set<string>(),
  grantedPermissions: new Set(['network', 'filesystem', 'subprocess'] as const),
  budget: DEFAULT_BUDGET,
};

actionsFor(registry, 'username', ctx); // ≤ 7 ranked transforms for the context menu
expand(registry, 'username', ctx, 2); // the plan behind the Expand button, nothing executed
```

## Deliberate decisions

- **Capability-first.** A transform names a capability, never a provider, so a provider can be
  swapped without touching a saved graph.
- **Terminal fallbacks.** Every chain ends in `external-link` or `manual-entry`; the registry
  refuses to validate a capability that can dead-end in an error.
- **Modes are enforced in the router**, not in the UI: an engine blocked by `strict-local` is
  unreachable, not merely hidden.
- **`credentials: 'optional'`** means an anonymous path genuinely exists (GitHub's 60 requests/hour),
  so such engines stay available in Zero-Credential Mode. `'required'` never does.
- **Exclusions are data.** Every dropped transform carries a reason the UI can turn into an offer
  ("configure this", "use the free alternative"). A silently shortened plan is the failure mode
  this layer exists to prevent.
- **No mock results.** An unavailable engine yields a status, never a fabricated entity.

## Keeping the catalogue honest

`test/catalog.contract.test.ts` fails when the code and `docs/ecosystem/*.md` disagree, when a
provider has no verification date, when a `core` transform stops being reachable without
credentials, or when a data licence loses its attribution. Re-verify a provider's limits against
its own documentation before changing `lastVerified`.
