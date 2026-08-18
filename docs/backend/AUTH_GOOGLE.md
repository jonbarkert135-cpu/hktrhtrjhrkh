# Google sign-in — not built, and exactly what it would take

**State: not started.** There is no Google button anywhere in the UI, disabled or otherwise
(`docs/adr/ADR-004-repository-abstraction.md`: no mocks in the core). The capability is declared —
`GOOGLE_AUTH_ENABLED`, requires `AUTH_ENABLED` — so the day it exists it is a configuration change.

## Why it is not needed yet

Local mode has no accounts at all. Server mode has email + password through Better-Auth
(`apps/api/src/auth/index.ts`), which is enough for a self-hosted deployment. Google sign-in matters
when Raven is offered to people who are not the operator.

## Implementation sketch (for whoever picks this up)

1. **Provider config.** Better-Auth already supports social providers; add the `google` provider in
   `apps/api/src/auth/index.ts` behind `capabilities.googleAuth`, reading `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` from the env schema in `packages/config/src/env.ts` (required only when the
   capability is on — use the same `superRefine` pattern as `AI_API_KEY`).
2. **Redirect URIs.** `PUBLIC_APP_URL` + `/auth/callback/google`, registered in the Google Cloud
   console. `AUTH_TRUSTED_ORIGINS` must contain the app origin or the cookie is refused.
3. **Account linking.** `Account` in `packages/db/prisma/schema.prisma` already models an external
   credential; link by verified email, and refuse to link an unverified one.
4. **Personal org.** New users must still pass through `apps/api/src/auth/personal-org.ts`, or they
   land with a session and no org and every `orgProcedure` returns FORBIDDEN.
5. **UI.** One button in `apps/web/src/app/auth/LoginPage.tsx`, rendered only when
   `capabilities.googleAuth` — never rendered in local mode, because that route does not exist there.
6. **Tests.** An e2e journey with a stubbed provider, plus a unit test asserting the button is absent
   when the capability is off.

## What must not happen

Do not make Google the only way in: a self-hosted deployment must stay usable with no third party
involved. Email + password stays a first-class path.
