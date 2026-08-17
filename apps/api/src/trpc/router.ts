import { router } from './trpc.js';
import { authRouter } from './routers/auth.js';
import { projectRouter } from './routers/project.js';
import { boardRouter } from './routers/board.js';

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  board: boardRouter,
});

/** Consumed by `apps/web` as a type-only import — the client never imports the runtime router. */
export type AppRouter = typeof appRouter;
