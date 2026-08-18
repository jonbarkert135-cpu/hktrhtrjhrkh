import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, redactValue, REDACT_CENSOR, SECRET_FIELD_NAMES } from '../src/log';
import { SECRET_ENV_KEYS } from '../src/env';

/** Capture one log line as parsed JSON. */
function capture(fn: (log: ReturnType<typeof createLogger>) => void): Record<string, unknown> {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const log = createLogger({ service: 'api', env: 'test', version: '0.1.0', destination: sink });
  fn(log);
  return JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
}

describe('logger', () => {
  it('emits the mandatory fields', () => {
    const line = capture((log) => log.info({ event: 'run.started', req_id: 'r1' }, 'started'));
    expect(line).toMatchObject({
      service: 'api',
      env: 'test',
      version: '0.1.0',
      level: 'info',
      msg: 'started',
      event: 'run.started',
      req_id: 'r1',
    });
    expect(typeof line.ts).toBe('string');
  });

  it.each(SECRET_FIELD_NAMES)('redacts the %s field', (field) => {
    const line = capture((log) => log.info({ [field]: 'super-secret-value' }, 'msg'));
    expect(JSON.stringify(line)).not.toContain('super-secret-value');
    expect(line[field]).toBe(REDACT_CENSOR);
  });

  it('proves every env secret name is in the redaction list', () => {
    for (const key of SECRET_ENV_KEYS) expect(SECRET_FIELD_NAMES).toContain(key);
  });

  it('redacts nested fields', () => {
    const line = capture((log) =>
      log.info({ req: { headers: { authorization: 'Bearer abcdefghijkl' } } }, 'm'),
    );
    expect(JSON.stringify(line)).not.toContain('abcdefghijkl');
  });

  it('redacts secret-shaped values inside the message', () => {
    const line = capture((log) => log.info('calling with Bearer abcdefghijklmnop'));
    expect(line.msg).toBe(`calling with ${REDACT_CENSOR}`);
  });
});

describe('redactValue', () => {
  it.each([
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9', 'eyJhbGciOiJIUzI1NiJ9'],
    ['key sk-abcdefghijklmnop', 'sk-abcdefghijklmnop'],
    ['postgres://user:hunter2@db:5432/raven', 'hunter2'],
    ['blob QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5', 'QUJDREVG'],
  ])('removes the secret from %s', (input, leaked) => {
    expect(redactValue(input)).not.toContain(leaked);
  });

  it('leaves ordinary text untouched', () => {
    expect(redactValue('board.open took 12 ms')).toBe('board.open took 12 ms');
  });
});
