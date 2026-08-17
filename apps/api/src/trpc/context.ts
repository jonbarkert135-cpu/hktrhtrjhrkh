import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@nexus/db';
import type { Auth } from '../auth/index.js';

export const ORG_ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export interface Logger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface ContextUser {
  id: string;
  email: string;
  name: string;
}

export interface Context {
  user: ContextUser | null;
  org: { id: string; name: string; slug: string } | null;
  role: OrgRole | null;
  req_id: string;
  ip: string;
  logger: Logger;
}

/** Fastify headers → the WHATWG `Headers` Better-Auth expects. */
export function toHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (typeof value === 'string') headers.set(key, value);
  }
  return headers;
}

export function createContextFactory(auth: Auth) {
  return async function createContext({
    req,
  }: {
    req: FastifyRequest;
    res: FastifyReply;
  }): Promise<Context> {
    const logger = req.log as unknown as Logger;
    const base = { user: null, org: null, role: null, req_id: req.id, ip: req.ip, logger };

    const session = await auth.api.getSession({ headers: toHeaders(req) });
    if (!session) return base;

    // P1 has exactly one org per user (the one created at signup), so the active org is the
    // user's first membership. Org switching (auth.switchOrg) arrives with multi-org in P7.
    const membership = await prisma.membership.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'asc' },
      include: { org: true },
    });

    return {
      ...base,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? session.user.email,
      },
      org: membership
        ? { id: membership.org.id, name: membership.org.name, slug: membership.org.slug }
        : null,
      role: membership?.role ?? null,
    };
  };
}
