import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ORG_ROLES } from './context.ts';
import type { Context, OrgRole } from './context.ts';

/**
 * Every procedure declares how it is authorized. `test/authz.matrix.test.ts` enumerates the
 * router and fails if a procedure has no `auth` meta, so a new procedure cannot be added
 * without a deliberate decision.
 */
export interface Meta {
  auth: 'public' | 'protected' | OrgRole;
}

const t = initTRPC
  .context<Context>()
  .meta<Meta>()
  .create({
    transformer: superjson,
    errorFormatter({ shape, error, ctx }) {
      return {
        ...shape,
        data: {
          ...shape.data,
          // 03_UX.md §12: the client maps `code` to copy and shows `req_id` behind "Details".
          code: error.code,
          req_id: ctx?.req_id ?? null,
        },
      };
    },
  });

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

export const rank = (role: OrgRole): number => ORG_ROLES.indexOf(role);
export const hasRole = (role: OrgRole | null, min: OrgRole): boolean =>
  role !== null && rank(role) >= rank(min);

export const publicProcedure = t.procedure.meta({ auth: 'public' });

export const protectedProcedure = t.procedure.meta({ auth: 'protected' }).use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired.' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Requires a session, an active org, and at least `minRole` in it. */
export const orgProcedure = (minRole: OrgRole) =>
  t.procedure.meta({ auth: minRole }).use(({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Your session has expired.' });
    }
    if (!ctx.org || !hasRole(ctx.role, minRole)) {
      ctx.logger.warn(
        { event: 'authz.denied', user_id: ctx.user.id, org_id: ctx.org?.id ?? null, minRole },
        'authorization denied',
      );
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: "You don't have access to this. Ask an organization admin for a higher role.",
      });
    }
    return next({ ctx: { ...ctx, user: ctx.user, org: ctx.org, role: ctx.role } });
  });
