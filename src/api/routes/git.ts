import type { FastifyInstance } from 'fastify';
import { getSession } from '../../db.ts';
import { getBranchChanges, getWorkingChanges } from '../git.ts';

export function registerGitRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { mode?: string } }>(
    '/api/sessions/:id/git',
    async (req, reply) => {
      const row = getSession(req.params.id);
      if (!row) {
        reply.code(404);
        return { error: 'not found' };
      }
      const mode = req.query?.mode === 'branch' ? 'branch' : 'working';
      try {
        const changes = mode === 'branch'
          ? await getBranchChanges(row.project_path)
          : await getWorkingChanges(row.project_path);
        return { changes };
      } catch (err) {
        reply.code(500);
        return { error: (err as Error).message };
      }
    }
  );
}
