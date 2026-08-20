/**
 * The egress allowlist proxy (10_INTEGRATIONS.md §6.4).
 *
 * The container network has no default route: the only thing a tool can reach is this process. It
 * authenticates every request with a per-run token, checks the host against that run's allowlist,
 * resolves the host *itself* and dials the resolved IP (so a DNS rebind cannot move the target
 * between check and connect, N7), rate-limits per run and logs every decision.
 *
 * The policy is a pure module so the DNS-rebinding corpus runs offline; the server around it is
 * thin on purpose.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect as tcpConnect, type Socket } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { Duplex } from 'node:stream';

import { isReservedIp } from '@nexus/integrations';

export interface RunEgressPolicy {
  readonly runId: string;
  readonly mode: 'none' | 'allowlist' | 'broad';
  readonly allow: readonly string[];
  readonly maxRequestsPerMinute: number;
  readonly expiresAt: number;
}

export type EgressDecision =
  | { readonly allowed: true; readonly host: string; readonly port: number }
  | { readonly allowed: false; readonly reason: EgressDenyReason };

export type EgressDenyReason =
  | 'unknown-token'
  | 'token-expired'
  | 'network-disabled'
  | 'host-not-allowed'
  | 'private-address'
  | 'redirect-limit'
  | 'rate-limited';

/** `*.example.org` matches a subdomain, never the apex — the apex must be listed on its own. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

/** Total 3xx hops per run, counted by the proxy because the tool follows them (§6.4 point 5). */
export const MAX_REDIRECT_HOPS = 20;

export interface EgressLogEntry {
  readonly runId: string;
  readonly ts: string;
  readonly method: string;
  readonly host: string;
  /** Hashed, never stored in clear: query strings carry the sensitive part (§6.4 point 7). */
  readonly pathHash: string;
  readonly status: number | null;
  readonly bytes: number;
  readonly decision: 'allowed' | EgressDenyReason;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class EgressPolicyStore {
  private readonly policies = new Map<string, RunEgressPolicy>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly redirects = new Map<string, number>();
  readonly log: EgressLogEntry[] = [];

  /** Mints a run's policy; the token is the run id plus a secret the runner already holds. */
  register(policy: RunEgressPolicy, now = Date.now()): void {
    this.policies.set(policy.runId, policy);
    this.buckets.set(policy.runId, { tokens: policy.maxRequestsPerMinute, updatedAt: now });
    this.redirects.set(policy.runId, 0);
  }

  revoke(runId: string): void {
    this.policies.delete(runId);
    this.buckets.delete(runId);
    this.redirects.delete(runId);
  }

  get(runId: string): RunEgressPolicy | undefined {
    return this.policies.get(runId);
  }

  countRedirect(runId: string): boolean {
    const seen = (this.redirects.get(runId) ?? 0) + 1;
    this.redirects.set(runId, seen);
    return seen <= MAX_REDIRECT_HOPS;
  }

  /** Token bucket with a 20%-of-the-minute burst (§6.4 point 6). */
  take(runId: string, now = Date.now()): boolean {
    const policy = this.policies.get(runId);
    const bucket = this.buckets.get(runId);
    if (policy === undefined || bucket === undefined) return false;
    const burst = Math.max(1, Math.ceil(policy.maxRequestsPerMinute * 0.2));
    const refill = (Math.max(0, now - bucket.updatedAt) / 60_000) * policy.maxRequestsPerMinute;
    bucket.tokens = Math.min(policy.maxRequestsPerMinute + burst, bucket.tokens + refill);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}

export type ResolveHost = (host: string) => Promise<readonly string[]>;

/** Default resolver: the OS resolver, all records, so every answer is checked, not just the first. */
export const systemResolver: ResolveHost = async (host) => {
  const answers = await dnsLookup(host, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

export interface AuthorizeInput {
  readonly token: string | undefined;
  readonly host: string;
  readonly port: number;
  readonly now?: number;
}

export interface AuthorizeResult {
  readonly decision: EgressDecision;
  /** The pinned address the caller must dial; SNI/Host stay the original name. */
  readonly address?: string;
}

/**
 * The whole policy in one function: token → run, host → allowlist, name → address, address →
 * private-range check, then the rate bucket. Order matters: an unauthenticated caller must not be
 * able to use the proxy as a DNS oracle, so resolution happens after the token and host checks.
 */
export async function authorize(
  store: EgressPolicyStore,
  input: AuthorizeInput,
  resolve: ResolveHost = systemResolver,
): Promise<AuthorizeResult> {
  const now = input.now ?? Date.now();
  const runId = input.token ?? '';
  const policy = store.get(runId);
  if (policy === undefined) return { decision: { allowed: false, reason: 'unknown-token' } };
  if (policy.expiresAt <= now) return { decision: { allowed: false, reason: 'token-expired' } };
  if (policy.mode === 'none') return { decision: { allowed: false, reason: 'network-disabled' } };
  if (
    policy.mode === 'allowlist' &&
    !policy.allow.some((pattern) => hostMatches(input.host, pattern))
  ) {
    return { decision: { allowed: false, reason: 'host-not-allowed' } };
  }
  if (!store.take(runId, now)) return { decision: { allowed: false, reason: 'rate-limited' } };

  let addresses: readonly string[];
  try {
    addresses = await resolve(input.host);
  } catch {
    return { decision: { allowed: false, reason: 'private-address' } };
  }
  if (addresses.length === 0) return { decision: { allowed: false, reason: 'private-address' } };
  // Every answer must be public: a rebinding attack returns one public and one private record and
  // relies on the client picking the second.
  if (addresses.some((address) => isReservedIp(address))) {
    return { decision: { allowed: false, reason: 'private-address' } };
  }
  return {
    decision: { allowed: true, host: input.host, port: input.port },
    address: addresses[0] ?? '',
  };
}

export function hashPath(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function tokenOf(request: { headers: Record<string, unknown> }): string | undefined {
  const header = request.headers['proxy-authorization'];
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

export interface ProxyServer {
  readonly server: Server;
  readonly store: EgressPolicyStore;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * The forward proxy. TLS is *not* intercepted (§6.4 point 8, Open risk 4): `CONNECT` is tunnelled
 * to the pinned IP with the host from the CONNECT line, so we enforce the destination without ever
 * holding the plaintext.
 */
export function createEgressProxy(resolve: ResolveHost = systemResolver): ProxyServer {
  const store = new EgressPolicyStore();

  const deny = (socketOrResponse: ServerResponse | Duplex, reason: EgressDenyReason): void => {
    const status = reason === 'rate-limited' ? 429 : 403;
    if ('writeHead' in socketOrResponse) {
      socketOrResponse.writeHead(status, reason === 'rate-limited' ? { 'retry-after': '1' } : {});
      socketOrResponse.end(reason);
      return;
    }
    socketOrResponse.end(`HTTP/1.1 ${String(status)} ${reason}\r\n\r\n`);
  };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const target = new URL(request.url ?? '/', 'http://invalid.invalid');
      const token = tokenOf({ headers: request.headers as Record<string, unknown> });
      const result = await authorize(
        store,
        { token, host: target.hostname, port: Number(target.port || 80) },
        resolve,
      );
      store.log.push({
        runId: token ?? '',
        ts: new Date().toISOString(),
        method: request.method ?? 'GET',
        host: target.hostname,
        pathHash: hashPath(target.pathname + target.search),
        status: null,
        bytes: 0,
        decision: result.decision.allowed ? 'allowed' : result.decision.reason,
      });
      if (!result.decision.allowed) {
        deny(response, result.decision.reason);
        return;
      }
      // Plain HTTP is proxied by tunnelling too: the tool's client speaks HTTP/1.1 to the pinned
      // address, and we never buffer or rewrite a body we are not allowed to inspect.
      const upstream = tcpConnect(result.decision.port, result.address ?? '', () => {
        response.writeHead(200);
        response.flushHeaders();
        (response.socket as Socket | null)?.pipe(upstream).pipe(response.socket as Socket);
      });
      upstream.on('error', () => {
        response.writeHead(502);
        response.end('upstream unavailable');
      });
    })();
  });

  server.on('connect', (request: IncomingMessage, clientSocket: Duplex, head: Buffer) => {
    void (async () => {
      const [rawHost = '', rawPort = '443'] = (request.url ?? '').split(':');
      const token = tokenOf({ headers: request.headers as Record<string, unknown> });
      const result = await authorize(
        store,
        { token, host: rawHost, port: Number(rawPort) },
        resolve,
      );
      store.log.push({
        runId: token ?? '',
        ts: new Date().toISOString(),
        method: 'CONNECT',
        host: rawHost,
        pathHash: hashPath(''),
        status: null,
        bytes: 0,
        decision: result.decision.allowed ? 'allowed' : result.decision.reason,
      });
      if (!result.decision.allowed) {
        deny(clientSocket, result.decision.reason);
        return;
      }
      const upstream = tcpConnect(result.decision.port, result.address ?? '', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
      clientSocket.on('error', () => upstream.destroy());
    })();
  });

  return {
    server,
    store,
    listen: (port) =>
      new Promise<number>((resolveListen) => {
        server.listen(port, '0.0.0.0', () => {
          const address = server.address();
          resolveListen(typeof address === 'object' && address !== null ? address.port : port);
        });
      }),
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose();
        });
      }),
  };
}
