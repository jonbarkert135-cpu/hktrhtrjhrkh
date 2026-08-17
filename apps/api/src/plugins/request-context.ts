import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export const REQ_ID_HEADER = 'x-request-id';

/**
 * Propagates `req_id`: reuse an inbound id when present (so a browser-reported id can be found
 * in the logs), otherwise Fastify's generated one, and always echo it back to the caller.
 */
export const requestContextPlugin = fp((app: FastifyInstance, _opts, done: () => void) => {
  app.addHook('onRequest', (req, reply, hookDone) => {
    reply.header(REQ_ID_HEADER, req.id);
    hookDone();
  });
  done();
});
