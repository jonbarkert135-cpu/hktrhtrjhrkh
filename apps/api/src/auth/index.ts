import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { prisma } from '@nexus/db';
import { z } from 'zod';
import type { ServerEnv } from '../env.ts';
import { audit } from '../audit.ts';
import type { AuditLogger } from '../audit.ts';
import { authLimiter, loginKey, signupKey, LOGIN_RULE, SIGNUP_RULE } from './rate-limit.ts';

const githubEnv = z
  .object({ GITHUB_CLIENT_ID: z.string().min(1), GITHUB_CLIENT_SECRET: z.string().min(1) })
  .safeParse(process.env);

const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS']);

const clientIp = (headers: Headers, fallback: string): string =>
  headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? fallback;

export function createAuth(env: ServerEnv) {
  const secureCookies = env.NEXUS_ENV !== 'local';

  return betterAuth({
    appName: 'nexus',
    secret: env.AUTH_SECRET,
    baseURL: env.PUBLIC_APP_URL,
    basePath: '/auth',
    trustedOrigins: env.AUTH_TRUSTED_ORIGINS,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    // Password hashing is Better-Auth's default (scrypt); never custom (P1 §9).
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 12 },
    ...(githubEnv.success
      ? {
          socialProviders: {
            github: {
              clientId: githubEnv.data.GITHUB_CLIENT_ID,
              clientSecret: githubEnv.data.GITHUB_CLIENT_SECRET,
            },
          },
        }
      : {}),
    session: {
      // 30-day rolling session: refreshed whenever it is older than a day.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies,
        path: '/',
      },
    },
    hooks: {
      before: createAuthMiddleware((ctx) => {
        const req = ctx.request;
        const method = req?.method ?? 'POST';
        const headers = req?.headers ?? new Headers();
        const ip = clientIp(headers, ctx.getHeader('x-real-ip') ?? 'unknown');

        // CSRF: cookie-authenticated non-idempotent routes must come from a trusted origin.
        if (!IDEMPOTENT.has(method)) {
          const origin = headers.get('origin');
          if (origin && !env.AUTH_TRUSTED_ORIGINS.includes(origin)) {
            throw new APIError('FORBIDDEN', {
              message: 'Request origin is not allowed. Sign in again from the app.',
              code: 'ORIGIN_NOT_ALLOWED',
            });
          }
        }

        if (ctx.path === '/sign-in/email') {
          const body = ctx.body as { email?: unknown } | undefined;
          const email = z.string().email().safeParse(body?.email);
          const result = authLimiter.hit(
            loginKey(ip, email.success ? email.data : 'unknown'),
            LOGIN_RULE,
          );
          if (!result.allowed) throw tooMany(result.retryAfterSec);
        }

        if (ctx.path === '/sign-up/email') {
          const result = authLimiter.hit(signupKey(ip), SIGNUP_RULE);
          if (!result.allowed) throw tooMany(result.retryAfterSec);
        }
        return Promise.resolve();
      }),
    },
  });
}

/**
 * Auth audit events (P1 §9). Called from the `/auth/*` route once the response status is known,
 * because Better-Auth's error hook does not expose the endpoint path.
 */
export async function auditAuthEvent(
  args: { path: string; status: number; email: unknown; ip: string },
  logger: AuditLogger,
): Promise<void> {
  const ok = args.status < 400;
  const action = args.path.endsWith('/sign-up/email')
    ? 'auth.signup'
    : args.path.endsWith('/sign-in/email') || args.path.includes('/callback/')
      ? ok
        ? 'auth.login'
        : 'auth.login_failed'
      : args.path.endsWith('/sign-out')
        ? 'auth.logout'
        : null;
  if (action === null) return;

  const email = z.string().email().safeParse(args.email);
  const orgId = email.success ? await orgIdForEmail(email.data) : null;
  await audit(
    {
      action,
      outcome: ok ? 'success' : 'denied',
      actorId: null,
      orgId,
      targetKind: 'user',
      targetId: null,
      ip: args.ip,
      metadata: { email: email.success ? email.data : null, status: args.status },
    },
    logger,
  );
}

async function orgIdForEmail(email: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    orderBy: { createdAt: 'asc' },
    select: { orgId: true },
  });
  return membership?.orgId ?? null;
}

function tooMany(retryAfterSec: number): APIError {
  return new APIError('TOO_MANY_REQUESTS', {
    message: `Too many attempts. Try again in ${retryAfterSec} seconds.`,
    code: 'RATE_LIMITED',
    retryAfter: retryAfterSec,
  });
}

export type Auth = ReturnType<typeof createAuth>;
