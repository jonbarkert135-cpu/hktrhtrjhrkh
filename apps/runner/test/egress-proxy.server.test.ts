/**
 * The proxy as a real server: an unregistered or unauthorized run is refused on both the plain
 * HTTP path and the CONNECT path, and every attempt is logged (§6.4).
 */

import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEgressProxy, type ProxyServer } from '../src/sandbox/egress-proxy.ts';

let proxy: ProxyServer;
let port = 0;

beforeAll(async () => {
  proxy = createEgressProxy(() => Promise.resolve(['93.184.216.34']));
  port = await proxy.listen(0);
});

afterAll(async () => {
  await proxy.close();
});

/** Sends a raw request line and returns the first line of the response. */
function raw(request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(request));
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      socket.end();
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

describe('egress proxy server', () => {
  it('refuses a proxied request that carries no run token', async () => {
    const response = await raw(
      'GET http://api.example.test/x?y=1 HTTP/1.1\r\nHost: api.example.test\r\n\r\n',
    );
    expect(response).toContain('403');
  });

  it('refuses a CONNECT from a run that was never registered', async () => {
    const response = await raw(
      'CONNECT api.example.test:443 HTTP/1.1\r\nProxy-Authorization: Bearer run-x\r\n\r\n',
    );
    expect(response).toContain('403');
  });

  it('rate-limits a registered run once its bucket is empty', async () => {
    proxy.store.register({
      runId: 'run-1',
      mode: 'broad',
      allow: [],
      maxRequestsPerMinute: 1,
      expiresAt: Date.now() + 60_000,
    });
    // Drain the bucket directly: an allowed request would try to reach the internet.
    expect(proxy.store.take('run-1', Date.now())).toBe(true);
    const response = await raw(
      'GET http://api.example.test/a HTTP/1.1\r\nHost: api.example.test\r\nProxy-Authorization: Bearer run-1\r\n\r\n',
    );
    expect(response).toContain('429');
  });

  it('logs every attempt with a hashed path, never the path itself', async () => {
    await raw('GET http://api.example.test/secret?y=1 HTTP/1.1\r\nHost: api.example.test\r\n\r\n');
    expect(proxy.store.log.length).toBeGreaterThan(0);
    for (const entry of proxy.store.log) {
      expect(entry.pathHash).toMatch(/^[0-9a-f]{8}$/);
      expect(JSON.stringify(entry)).not.toContain('?y=1');
    }
  });
});
