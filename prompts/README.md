# Source prompts

The product owner's original briefs, stored verbatim so an AI agent can read the requirement
instead of re-deriving it from chat history. **Read the relevant prompt before planning work that
touches its area, and do not re-litigate decisions that are already written down here.**

| File                                             | Covers                                                                                        | Status                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `../Дорожная карта для ии разроботчика сайта.md` | The master prompt and the phase roadmap (P1–P16). The live progress tracker lives at its end. | Being executed — see `RAVEN-SPEC/20_ROADMAP.md`.                                                                                       |
| `PROMPT_4_MALTEGO_ECOSYSTEM_RU.md`               | Layer 4: Maltego-ecosystem audit, transform/connector system, advanced integration layer.     | In progress — L4.1 done (`RAVEN-SPEC/21_TRANSFORM_SYSTEM.md`, `docs/ecosystem/`, `packages/transforms`); L4.2–L4.7 in `20_ROADMAP.md`. |

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
