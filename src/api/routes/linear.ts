import type { FastifyInstance } from 'fastify';
import { isConfigured, listMyIssues, listProjects, getIssue } from '../../linear.ts';

export function registerLinearRoutes(app: FastifyInstance) {
  app.get('/api/linear/status', async () => {
    return { configured: isConfigured() };
  });

  app.get<{ Querystring: { projectId?: string; stateType?: string } }>(
    '/api/linear/issues',
    async (req, reply) => {
      if (!isConfigured()) {
        reply.code(503);
        return { error: 'Linear API key not configured' };
      }
      const { projectId, stateType } = (req.query ?? {}) as { projectId?: string; stateType?: string };
      const issues = await listMyIssues({
        projectId: projectId || undefined,
        stateType: stateType || undefined,
      });
      return { issues };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/linear/issues/:id',
    async (req, reply) => {
      if (!isConfigured()) {
        reply.code(503);
        return { error: 'Linear API key not configured' };
      }
      try {
        const issue = await getIssue(req.params.id);
        return { issue };
      } catch (e) {
        reply.code(404);
        return { error: (e as Error).message };
      }
    }
  );

  app.get('/api/linear/projects', async (req, reply) => {
    if (!isConfigured()) {
      reply.code(503);
      return { error: 'Linear API key not configured' };
    }
    const projects = await listProjects();
    return { projects };
  });
}
