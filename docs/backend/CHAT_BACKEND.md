# Chat / assistant backend — not built

**State: not started.** No chat UI, no endpoint, no provider key in use. `AI_PROVIDER` defaults to
`mock` in `packages/config/src/env.ts`, which is what CI runs.

## Intended shape (RAVEN-SPEC/14_AI_AGENT.md, roadmap P9)

- One server route (`ai.*` on the tRPC router) rather than provider calls from the browser: the API
  key must never reach a bundle, and the monthly budget (`AI_MONTHLY_BUDGET_USD`) must be enforced in
  one place.
- Provider-agnostic: an OpenAI-compatible base URL, so a self-hoster can point it at a local model.
- **Nothing the assistant produces enters the graph directly.** It emits a _proposal_ the user
  reviews, applies and can undo — the same rule that governs tool output.
- Every proposal carries provenance (model, prompt hash, timestamp) into the node's provenance record.

## In local mode

A local build with no backend can still use an assistant only if the user supplies their own endpoint
and accepts that the request leaves the machine. That is a deliberate, explicit opt-in and is not
implemented; until it is, local mode has no AI at all, and the UI does not pretend otherwise.
