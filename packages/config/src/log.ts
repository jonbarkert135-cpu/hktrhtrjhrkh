import { pino } from 'pino';
import type { DestinationStream, Logger, LoggerOptions } from 'pino';
import { SECRET_ENV_KEYS } from './env.ts';

export const REDACT_CENSOR = '[redacted]';

/** Field names that must never reach a log sink (19_DEPLOYMENT.md §10.3). */
export const SECRET_FIELD_NAMES = [
  'password',
  'token',
  'authorization',
  'cookie',
  'apiKey',
  'secret',
  ...SECRET_ENV_KEYS,
] as const;

const CASE_VARIANTS = (name: string): string[] => [
  name,
  name.toLowerCase(),
  name.toUpperCase(),
  // snake_case field names show up in HTTP/OTel payloads
  name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
];

const FIELD_PATHS = [...new Set(SECRET_FIELD_NAMES.flatMap(CASE_VARIANTS))].flatMap((f) => [
  f,
  `*.${f}`,
  `req.headers.${f}`,
  `res.headers.${f}`,
]);

/** Values shaped like a secret (long opaque strings, bearer tokens, URLs with credentials). */
const SECRET_SHAPED = [
  /\bBearer\s+[\w.\-+/=]{8,}/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
  /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
];

/** Redact secret-shaped substrings from a free-form string (log messages, error text). */
export function redactValue(value: string): string {
  let out = value;
  for (const re of SECRET_SHAPED) {
    out = re.source.includes('://')
      ? out.replace(re, `$1${REDACT_CENSOR}@`)
      : out.replace(re, REDACT_CENSOR);
  }
  return out;
}

export interface LoggerConfig {
  service: string;
  env: string;
  version: string;
  level?: LoggerOptions['level'];
  /** Alternate sink; defaults to stdout. Used by tests and by the audit stream. */
  destination?: DestinationStream;
}

/**
 * Pino logger with the mandatory NEXUS fields. `service`/`env`/`version` are bindings;
 * per-request fields (`trace_id`, `span_id`, `req_id`, `org_id`, `user_id`, `event`) are
 * supplied by callers via `logger.child({...})` or the first log argument.
 */
export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level ?? 'info',
    base: { service: config.service, env: config.env, version: config.version },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: { level: (label) => ({ level: label }) },
    messageKey: 'msg',
    redact: { paths: FIELD_PATHS, censor: REDACT_CENSOR },
    hooks: {
      logMethod(args, method) {
        const [first, ...rest] = args;
        if (typeof first === 'string') return method.apply(this, [redactValue(first), ...rest]);
        if (rest.length > 0 && typeof rest[0] === 'string')
          return method.apply(this, [first, redactValue(rest[0]), ...rest.slice(1)]);
        return method.apply(this, args);
      },
    },
  };
  return config.destination ? pino(options, config.destination) : pino(options);
}
