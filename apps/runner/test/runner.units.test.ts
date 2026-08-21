/**
 * Unit cover for the small runner runtime pieces: cancellation, the run log writer, the node
 * fetch/DNS runtime and secret materialization.
 */

import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestCancel, watchCancel, type CancelBackend } from '../src/cancel.ts';
import { RunLogWriter, type RunLogEntry, type RunLogStore } from '../src/runlog.ts';
import { cancelKey } from '../src/protocol.ts';
import { materializeSecrets, redactEnv, scrub } from '../src/sandbox/secrets.ts';

function backend(): CancelBackend & {
  keys: Map<string, string>;
  emit: (message: string) => void;
} {
  const keys = new Map<string, string>();
  let listener: ((message: string) => void) | undefined;
  return {
    keys,
    emit: (message) => listener?.(message),
    get: (key) => Promise.resolve(keys.get(key) ?? null),
    set: (key, value) => {
      keys.set(key, value);
      return Promise.resolve();
    },
    subscribe: (_channel, fn) => {
      listener = fn;
      return Promise.resolve(() => {
        listener = undefined;
        return Promise.resolve();
      });
    },
  };
}

describe('cancellation', () => {
  it('writes the cancel key with the run wall clock as its ttl', async () => {
    const redis = backend();
    await requestCancel(redis, 'run-1', 60_000);
    expect(redis.keys.get(cancelKey('run-1'))).toBe('1');
  });

  it('trips on a pub/sub message and resolves the signal exactly once', async () => {
    const redis = backend();
    const watch = await watchCancel(redis, 'run-1');
    expect(watch.cancelled()).toBe(false);
    redis.emit('noise');
    expect(watch.cancelled()).toBe(false);
    redis.emit('cancel');
    redis.emit('cancel');
    await watch.signal;
    expect(watch.cancelled()).toBe(true);
    await watch.stop();
  });

  it('also trips from the poll, because the key outlives a dropped socket', async () => {
    const redis = backend();
    const watch = await watchCancel(redis, 'run-2', { pollMs: 5 });
    await redis.set(cancelKey('run-2'), '1', 1000);
    await watch.signal;
    expect(watch.cancelled()).toBe(true);
    await watch.stop();
  });
});

function store(): RunLogStore & { entries: RunLogEntry[]; seq: number } {
  const state = {
    entries: [] as RunLogEntry[],
    seq: 0,
    append: (batch: readonly RunLogEntry[]) => {
      state.entries.push(...batch);
      return Promise.resolve();
    },
    nextSeq: () => Promise.resolve(state.seq),
  };
  return state;
}

describe('run log writer', () => {
  it('continues the sequence of an existing run and flushes in one batch', async () => {
    const sink = store();
    sink.seq = 7;
    const writer = new RunLogWriter({ runId: 'run-1', store: sink, now: () => 'now' });
    await writer.start();
    writer.log({ level: 'info', phase: 'exec', message: 'first' });
    writer.log({ level: 'info', phase: 'exec', message: 'second', data: { a: 1 } });
    expect(sink.entries).toHaveLength(0);
    await writer.flush();
    expect(sink.entries.map((entry) => entry.seq)).toEqual([7, 8]);
    expect(sink.entries[0]?.at).toBe('now');
    expect(sink.entries[1]?.data).toEqual({ a: 1 });
  });

  it('starts lazily on flush, and flushing an empty buffer writes nothing', async () => {
    const sink = store();
    const writer = new RunLogWriter({ runId: 'run-1', store: sink });
    await writer.flush();
    expect(sink.entries).toEqual([]);
  });

  it('scrubs and truncates messages, and publishes everything but debug', async () => {
    const sink = store();
    const published: { level: string; message: string }[] = [];
    const writer = new RunLogWriter({
      runId: 'run-1',
      store: sink,
      scrub: (text) => text.replaceAll('hunter2hunter2', '«redacted»'),
      publisher: {
        publish: (_runId, event) => published.push({ level: event.level, message: event.message }),
      },
    });
    writer.log({ level: 'debug', phase: 'exec', message: 'quiet' });
    writer.log({ level: 'warn', phase: 'exec', message: 'token hunter2hunter2' });
    writer.log({ level: 'info', phase: 'exec', message: 'x'.repeat(3000) });
    await writer.flush();
    expect(published).toHaveLength(2);
    expect(published[0]?.message).toBe('token «redacted»');
    expect(sink.entries[2]?.message).toHaveLength(2000);
  });

  it('auto-flushes once the batch size is reached', async () => {
    const sink = store();
    const writer = new RunLogWriter({ runId: 'run-1', store: sink, flushEvery: 2 });
    await writer.start();
    writer.log({ level: 'info', phase: 'exec', message: 'a' });
    writer.log({ level: 'info', phase: 'exec', message: 'b' });
    await vi.waitFor(() => expect(sink.entries).toHaveLength(2));
  });

  it('renders a canonical error payload as one error line', async () => {
    const sink = store();
    const writer = new RunLogWriter({ runId: 'run-1', store: sink });
    writer.error('exec', {
      code: 'TOOL_EXIT_NONZERO',
      what: 'The tool failed.',
      why: 'It exited with 2.',
      action: 'Check the tool logs.',
      retryable: false,
      runId: 'run-1',
    });
    await writer.flush();
    expect(sink.entries[0]?.message).toContain('TOOL_EXIT_NONZERO');
    expect(sink.entries[0]?.data).toEqual({ code: 'TOOL_EXIT_NONZERO', retryable: false });
  });
});

describe('secrets', () => {
  let base = '';

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'raven-secrets-'));
  });

  it('puts env secrets in env only, and file secrets on disk at 0400', async () => {
    const materialized = await materializeSecrets({
      runId: 'run-1',
      projectId: 'proj-1',
      secretEnv: { API_TOKEN: 'tool.api', MISSING: 'tool.absent' },
      secretFiles: ['tool.api', 'tool.absent'],
      baseDir: base,
      resolver: {
        read: (name) => Promise.resolve(name === 'tool.api' ? 'sekrit-value-1' : undefined),
      },
    });

    expect(materialized.env).toEqual({ API_TOKEN: 'sekrit-value-1' });
    expect(materialized.values).toEqual(['sekrit-value-1', 'sekrit-value-1']);
    const file = join(materialized.dir, 'tool.api');
    expect(await readFile(file, 'utf8')).toBe('sekrit-value-1');
    expect((await stat(file)).mode & 0o777).toBe(0o400);

    await materialized.cleanup();
    await expect(stat(materialized.dir)).rejects.toThrow();
  });

  it('writes no directory at all when no secret files are declared', async () => {
    const materialized = await materializeSecrets({
      runId: 'run-2',
      projectId: 'proj-1',
      secretEnv: {},
      secretFiles: [],
      baseDir: base,
      resolver: { read: () => Promise.resolve('unused') },
    });
    await expect(stat(materialized.dir)).rejects.toThrow();
  });

  it('scrubs long values only, and redacts secret-backed env keys', () => {
    expect(scrub('a sekrit-value-1 b', { api: 'sekrit-value-1' })).toBe('a «redacted:api» b');
    expect(scrub('short', { api: 'short' })).toBe('short');
    expect(redactEnv({ API_TOKEN: 'sekrit', HOME: '/work' }, { API_TOKEN: 'tool.api' })).toEqual({
      API_TOKEN: '«redacted:tool.api»',
      HOME: '/work',
    });
  });
});

const transportRequest = (headers: Record<string, string> = {}) => ({
  url: new URL('https://example.test/'),
  pinned: { hostname: 'example.test', address: '93.184.216.34', family: 4 as const },
  headers,
  signal: new AbortController().signal,
});

describe('node runtime for safeFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('resolves every address the OS returns', async () => {
    vi.doMock('node:dns/promises', () => ({
      lookup: () =>
        Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '2606:2800::1', family: 6 },
        ]),
    }));
    const { nodeResolver } = await import('../src/net.ts');
    expect(await nodeResolver('example.test')).toEqual(['93.184.216.34', '2606:2800::1']);
  });

  it('streams the response body and never follows a redirect itself', async () => {
    const fetchMock = vi.fn((_url: URL | string, _init?: RequestInit) =>
      Promise.resolve(
        new Response('hello', { status: 301, headers: { location: 'https://elsewhere.test/' } }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { nodeTransport } = await import('../src/net.ts');

    const response = await nodeTransport(transportRequest({ a: 'b' }));
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://elsewhere.test/');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual', method: 'GET' });

    let body = '';
    for await (const chunk of response.body()) body += new TextDecoder().decode(chunk);
    expect(body).toBe('hello');
  });

  it('yields nothing when the response has no body', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 204 })));
    const { nodeTransport } = await import('../src/net.ts');
    const response = await nodeTransport(transportRequest());
    const chunks = [];
    for await (const chunk of response.body()) chunks.push(chunk);
    expect(chunks).toEqual([]);
  });
});
