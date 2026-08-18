# Documentation index

| Document                                                                       | Read it when                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md)                                   | You are new here. Start with this one.                |
| [adr/ADR-001-local-first.md](adr/ADR-001-local-first.md)                       | You want to know why there is no login screen         |
| [adr/ADR-002-feature-flags.md](adr/ADR-002-feature-flags.md)                   | You are adding an optional subsystem                  |
| [adr/ADR-003-local-database.md](adr/ADR-003-local-database.md)                 | You are wondering "why not SQLite?"                   |
| [adr/ADR-004-repository-abstraction.md](adr/ADR-004-repository-abstraction.md) | You are about to write `if (local)`                   |
| [adr/ADR-005-modular-monolith.md](adr/ADR-005-modular-monolith.md)             | You are considering a new service                     |
| [backend/BACKEND_STATUS.md](backend/BACKEND_STATUS.md)                         | You need to know what the backend actually does today |
| [backend/BACKEND_SETUP.md](backend/BACKEND_SETUP.md)                           | You are turning the server shape on                   |
| [backend/BACKEND_ARCHITECTURE.md](backend/BACKEND_ARCHITECTURE.md)             | You are changing the request path                     |
| [backend/BACKEND_API.md](backend/BACKEND_API.md)                               | You are adding or calling a procedure                 |
| [backend/DATABASE.md](backend/DATABASE.md)                                     | You are touching the schema                           |
| [backend/DEPLOYMENT.md](backend/DEPLOYMENT.md)                                 | You are putting this on a machine                     |
| [backend/SYNC_ARCHITECTURE.md](backend/SYNC_ARCHITECTURE.md)                   | You are implementing device↔server sync              |
| [backend/AUTH_GOOGLE.md](backend/AUTH_GOOGLE.md)                               | Someone asked for "Sign in with Google"               |
| [backend/CHAT_BACKEND.md](backend/CHAT_BACKEND.md)                             | Someone asked for the AI assistant                    |
| [backend/FUTURE_AI_BACKEND.md](backend/FUTURE_AI_BACKEND.md)                   | **You are an AI agent about to change this repo**     |

The product specification itself lives in [`../RAVEN-SPEC/`](../RAVEN-SPEC/); the phase tracker is
`RAVEN-SPEC/20_ROADMAP.md`.

## Moving a project between shapes

Local mode is not a dead end: a board exports to a portable archive
(`packages/domain/src/export/exportBoard.ts`, schema `export/schema.v1.ts`) and imports back through
`apps/web/src/app/board/ImportDialog.tsx`. The same archive imports into a server deployment, which
is the supported path from "my laptop" to "my VPS" until cloud sync exists
([backend/SYNC_ARCHITECTURE.md](backend/SYNC_ARCHITECTURE.md)).
