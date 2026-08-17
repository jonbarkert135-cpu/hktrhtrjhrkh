import { systemClock } from '@nexus/domain';
import { publicProcedure, router } from '../trpc.ts';

export const authRouter = router({
  /**
   * The SPA's boot query: who am I, which org am I in, what time does the server think it is
   * (P1 §8 — session validity is decided by server time only, never the client clock).
   */
  session: publicProcedure.query(({ ctx }) => ({
    user: ctx.user,
    org: ctx.org,
    role: ctx.role,
    serverTime: systemClock.now(),
  })),
});
