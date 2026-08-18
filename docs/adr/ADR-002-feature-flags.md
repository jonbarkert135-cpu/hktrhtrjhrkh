# ADR-002 — One capability registry instead of scattered environment checks

**Status:** accepted · 2026-08-18

## Context

A two-shape product invites a specific kind of rot: `if (import.meta.env.VITE_SOMETHING)` sprinkled
through components, each with its own default and its own idea of what "off" means. That is how a
codebase ends up with a Login button that renders in a build with no auth server, or a sync
indicator that spins forever because a variable was spelled differently in two files.

## Decision

Every optional subsystem is declared once, in `packages/config/src/appMode.ts`:

| Capability       | Variable                  | Depends on             |
| ---------------- | ------------------------- | ---------------------- |
| `backend`        | `BACKEND_ENABLED`         | —                      |
| `auth`           | `AUTH_ENABLED`            | `backend`              |
| `googleAuth`     | `GOOGLE_AUTH_ENABLED`     | `auth`                 |
| `cloudSync`      | `CLOUD_SYNC_ENABLED`      | `backend`              |
| `remoteDatabase` | `REMOTE_DATABASE_ENABLED` | `backend`              |
| `collaboration`  | `COLLABORATION_ENABLED`   | `backend`, `cloudSync` |

- `APP_MODE` sets the defaults (`local` → everything off; `server` → backend, auth, remote database).
- An explicit variable may only _narrow_ a local deployment; switching a networked capability on
  while `APP_MODE=local` is a configuration error, not a supported combination.
- Values are strict: `true`/`false`/`1`/`0`. `AUTH_ENABLED=yes` fails the boot instead of silently
  meaning "off".
- The browser reads the same names under the `VITE_` prefix, so one deployment describes itself once.

These flags gate **unfinished or optional surfaces**. They are never a security control: the API
authorizes every request regardless of what the bundle believes.

## Consequences

Adding a subsystem means adding one row and its dependency edge; the resolver then rejects every
half-configured combination automatically. The cost is that a genuinely independent capability must
still be declared here rather than read ad hoc — which is the point.
