import type { FastifyInstance } from 'fastify';
import { log, type LogLevel } from '../../log.ts';

export function registerLogRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  app.post<{ Body: { level?: LogLevel; msg?: string; stack?: string; url?: string } }>(
    '/api/log',
    async (req, reply) => {
      const { level = 'error', msg = '(empty)', stack, url } = req.body ?? {};
      log(level, 'web', String(msg).slice(0, 4000), {
        stack: stack ? String(stack).slice(0, 8000) : undefined,
        url,
      });
      reply.code(204).send();
    }
  );
}
