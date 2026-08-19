# Source prompts

The product owner's original briefs, stored verbatim so an AI agent can read the requirement
instead of re-deriving it from chat history. **Read the relevant prompt before planning work that
touches its area, and do not re-litigate decisions that are already written down here.**

| File                                             | Covers                                                                                             | Status                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `../Дорожная карта для ии разроботчика сайта.md` | The master prompt and the phase roadmap (P1–P16). The live progress tracker lives at its end.      | Being executed — see `RAVEN-SPEC/20_ROADMAP.md`.                                                                                       |
| `PROMPT_2_UNIFIED_INTELLIGENCE_PLATFORM_RU.md`   | Layer 2: ecosystem + competitor audit and the unified query/orchestration layer above the engines. | Designed — `RAVEN-SPEC/22`, `23`, `24`; implemented by phase **P17**.                                                                  |
| `PROMPT_4_MALTEGO_ECOSYSTEM_RU.md`               | Layer 4: Maltego-ecosystem audit, transform/connector system, advanced integration layer.          | In progress — L4.1 done (`RAVEN-SPEC/21_TRANSFORM_SYSTEM.md`, `docs/ecosystem/`, `packages/transforms`); L4.2–L4.7 in `20_ROADMAP.md`. |

## Reading rules for agents

1. The product is named **Raven OSINT**. Every "NEXUS" in these prompts means Raven OSINT; the name
   is the only thing that changed. Internal identifiers (`@nexus/*` packages, `NEXUS_*` env
   variables, the `nexus` database) are deliberately still called nexus — renaming them is a
   separate, CI-coupled task.
2. The prompts are requirements, not designs. The design that implements them is `RAVEN-SPEC/`,
   and `RAVEN-SPEC/00_MASTER.md` wins on any conflict with a prompt's wording.
3. Do not implement a prompt directly. Turn it into (or find) a phase in
   `RAVEN-SPEC/20_ROADMAP.md`, then implement that phase, one PR per phase.
4. Tick the phase off in **both** trackers when it is done: `RAVEN-SPEC/20_ROADMAP.md` (the
   `**Status: DONE**` line under the phase heading) and the checklist at the end of the Russian
   roadmap file.

## Parallel work — file ownership

Layers 2 and 4 are being built at the same time by two different agents. To keep them from
colliding, ownership is by file:

| Area                                                                                                                                                  | Owner        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `docs/ecosystem/**`, `RAVEN-SPEC/21_TRANSFORM_SYSTEM.md`, `packages/transforms/**`, the `L4` section of `RAVEN-SPEC/20_ROADMAP.md`                    | Layer 4 (L4) |
| `RAVEN-SPEC/22_ECOSYSTEM_AUDIT.md`, `RAVEN-SPEC/23_COMPETITOR_MATRIX.md`, `RAVEN-SPEC/24_UNIFIED_QUERY.md`, phase **P17**, `packages/query-engine/**` | Layer 2      |

Spec numbering is therefore split: **21** belongs to L4 (transform system), **22–24** to layer 2.

The dependency runs one way only: the unified query layer consumes the transform registry
(`RAVEN-SPEC/24_UNIFIED_QUERY.md` §12); the transform layer must not depend on it. Canvas, nodes,
edges, the visual shell, `apps/web`, `apps/api` and specs 05–07 belong to neither of these two
layers and are owned by the phase work (P5, visual shell).
