import { router } from './trpc.ts';
import { authRouter } from './routers/auth.ts';
import { projectRouter } from './routers/project.ts';
import { boardRouter } from './routers/board.ts';
import { boardTokenRouter } from './routers/boardToken.ts';
import { commentsRouter } from './routers/comments.ts';
import { filesRouter } from './routers/files.ts';
import { unfurlRouter } from './routers/unfurl.ts';

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  board: boardRouter,
  boardToken: boardTokenRouter,
  comments: commentsRouter,
  files: filesRouter,
  unfurl: unfurlRouter,
});

/** Consumed by `apps/web` as a type-only import — the client never imports the runtime router. */
export type AppRouter = typeof appRouter;
