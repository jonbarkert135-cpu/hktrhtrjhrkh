# @nexus/config

Shared configuration for the monorepo: env schemas, feature flags, logger, ESLint config +
the design-token lint rule, tsconfig presets and the Vitest config factory.
Source-only package (no build step); consumers compile `./src/*.ts`.

| Export                                     | Contents                                                     |
| ------------------------------------------ | ------------------------------------------------------------ |
| `@nexus/config`                            | everything from `src/index.ts`                               |
| `@nexus/config/env`                        | `serverEnv`, `clientEnv`, `loadServerEnv`, `SECRET_ENV_KEYS` |
| `@nexus/config/flags`                      | `parseFlags`, `FLAG_NAMES`, `FlagName`                       |
| `@nexus/config/log`                        | `createLogger`, `redactValue`                                |
| `@nexus/config/eslint`                     | `base`, `node`, `react`, `domainStrict` flat configs         |
| `@nexus/config/tsconfig/{base,react,node}` | tsconfig presets                                             |
| `@nexus/config/vitest`                     | `nodeConfig()`, `jsdomConfig()`, `COVERAGE_TARGETS`          |

## Adding an env var

1. Add the field to `serverEnv` in `src/env.ts` (or `clientEnv` if it is a **non-secret**
   `VITE_`-prefixed value). Required by default — only add `.default()` when the fallback is safe
   in production.
2. If it is a secret, add its name to `SECRET_ENV_KEYS`; the logger redaction list and
   `test/redact.test.ts` pick it up automatically.
3. Add it to `.env.example` with a dummy value, and to the deployment secrets (`19_DEPLOYMENT.md`).
4. Cross-field constraints go in the `superRefine` block, with a message that says what to do.
5. `loadServerEnv()` throws `EnvValidationError` listing **every** offending variable, one line
   each — never fix errors one boot at a time.

## Feature flags

`FEATURE_FLAGS` is a csv of names from the closed `FLAG_NAMES` union; an unknown name throws at
boot. Add the flag name to `FLAG_NAMES` and record owner + expiry in `docs/flags.md`
(19_DEPLOYMENT.md §9).

## The `nexus/no-hardcoded-design-values` rule

Reports, in string literals, template literals and JSX `style={{ … }}` objects:

- hex colors (`#0f172a`, `#fff`, 8-digit)
- raw px values — `0`, `0px` and `1px` are allowed (borders and zero)
- raw durations in `ms`/`s`

Use `@nexus/ui` tokens instead: `var(--color-surface-1)`, `var(--space-4)`, `var(--motion-fast)`.

Opting out:

- **A file** — pass its path fragment in the rule options:
  `'nexus/no-hardcoded-design-values': ['error', { allowFiles: ['packages/ui/src/tokens/'] }]`
  (each entry is a regex source matched against the filename). Token definitions and the generated
  Tailwind preset are the legitimate cases.
- **One line** — `// eslint-disable-next-line nexus/no-hardcoded-design-values` with a comment
  saying why.

## Tests

`pnpm --filter @nexus/config test` — env matrices, redaction corpus, flags, and a `RuleTester`
suite for the lint rule.
