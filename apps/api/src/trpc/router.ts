import { router } from './trpc.ts';
import { authRouter } from './routers/auth.ts';
import { projectRouter } from './routers/project.ts';
import { boardRouter } from './routers/board.ts';

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  board: boardRouter,
});

/** Consumed by `apps/web` as a type-only import — the client never imports the runtime router. */
export type AppRouter = typeof appRouter;
