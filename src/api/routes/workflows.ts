import type { FastifyInstance } from 'fastify';
import {
  listWorkflows,
  getWorkflow,
  upsertWorkflow,
  deleteWorkflow,
  type WorkflowRow,
} from '../../db.ts';

type WorkflowView = {
  id: string;
  label: string;
  description: string | null;
  body: string;
  builtin: boolean;
  version: number;
  updated_at: number;
};

function toView(row: WorkflowRow): WorkflowView {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    body: row.body,
    builtin: row.builtin === 1,
    version: row.version,
    updated_at: row.updated_at,
  };
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function registerWorkflowRoutes(app: FastifyInstance) {
  app.get('/api/workflows', async () => {
    return { workflows: listWorkflows().map(toView) };
  });

  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (req, reply) => {
    const row = getWorkflow(req.params.id);
    if (!row) {
      reply.code(404);
      return { error: 'not found' };
    }
    return { workflow: toView(row) };
  });

  app.put<{
    Params: { id: string };
    Body: { label?: string; description?: string | null; body?: string };
  }>('/api/workflows/:id', async (req, reply) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) {
      reply.code(400);
      return { error: 'id must be lowercase alphanumeric with dashes' };
    }
    const body = req.body ?? {};
    const existing = getWorkflow(id);
    const label = (body.label ?? existing?.label ?? '').trim();
    const text = (body.body ?? existing?.body ?? '').trim();
    if (!label || !text) {
      reply.code(400);
      return { error: 'label and body are required' };
    }
    upsertWorkflow({
      id,
      label,
      description: body.description ?? existing?.description ?? null,
      body: text,
      // Editing a built-in keeps it flagged builtin so the seeder can still
      // upgrade it on the next version bump; user-created ids stay user-owned.
      builtin: existing?.builtin === 1,
      version: existing?.version ?? 1,
    });
    return { workflow: toView(getWorkflow(id)!) };
  });

  app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (req) => {
    deleteWorkflow(req.params.id);
    return { ok: true };
  });
}
