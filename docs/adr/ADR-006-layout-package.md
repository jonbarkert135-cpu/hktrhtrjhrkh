# ADR-006 — Auto-layout lives in its own package, `@nexus/layout`

- **Status:** accepted (P14a, branch `phase/p14a-auto-layout`)
- **Supersedes / amends:** nothing. Complements `00_MASTER.md` §6 (layer rules) and
  `05_CANVAS_ENGINE.md` §9 (worker architecture).

## Context

P14a adds seven layout algorithms plus overlap separation, scoping and diffing. Three homes were
possible:

1. **`packages/canvas-engine`** — it already owns geometry and it already has a worker story.
2. **`packages/domain`** — it owns the graph the layout reads.
3. **A new `packages/layout`.**

## Decision

A new package, `@nexus/layout`, with **no internal dependencies at all**.

## Why not the canvas engine

The engine's job is "paint what exists and turn input into intents". Layout is the opposite
direction: it proposes new geometry that the _document_ may adopt after an accept. Putting it in the
engine would mean either the engine gains a concept it must never have (a proposal), or the app has
to import a layout function from a rendering package and hand the result to Yjs — a dependency edge
that says nothing true about the system. It would also grow the engine bundle for every board that
never runs a layout.

## Why not the domain package

`domain-is-pure` in `.dependency-cruiser.cjs` allows `packages/domain` to depend only on itself and
`config`, so a layout module _could_ live there. But `packages/domain` is the correctness-critical
package: schemas, mutations, undo, provenance. Layout is heuristics — the "right" answer is a matter
of taste, and its tests are geometric properties, not invariants of the record model. Mixing the two
would drag layout under domain's 90 % coverage gate for reasons that have nothing to do with data
integrity, and would let a layout change touch the file that owns the CRDT write path.

## Consequences

- `@nexus/layout` imports nothing internal. It defines its own five-field `LayoutNode`, so it can be
  driven from the web app, a worker, the bench harness and a unit test without Yjs, React or a DOM.
  The mapping from `BoardNode` lives in the app (`apps/web/src/layout/graphFromDoc.ts`), which is
  where the node type registry already is.
- No dependency-cruiser rule needed changing; the package satisfies `packages-never-import-apps` and
  `no-circular` trivially. Coverage floor is registered in `packages/config/vitest/base.ts`
  (90 % lines / 85 % branches — the same floor as domain, because the algorithms are pure).
- No third-party layout library (elkjs, dagre, d3-force). Each of them is 100–500 kB, all of them
  own their own graph model, and none of them is deterministic _and_ cancellable _and_ free of a
  DOM assumption. The seven algorithms here are ~900 lines and their determinism is asserted.
- The web app runs the package in a module worker (`apps/web/src/layout/layout.worker.ts`) with an
  inline fallback, so N1 holds on a 5,000-node board and a run is cancellable.
