import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  listSessions,
  getSession,
  setUserStatus,
  setTitle,
  setNotes,
  insertLaunchPlaceholderStmt,
  db,
} from '../db.ts';
import { runScanOnce } from '../scanner/index.ts';
import { launchSession } from '../launcher/terminal.ts';
import { viewAll, toView, type SessionView } from './state.ts';
import { listRunningCwds } from '../db.ts';

type RepoSummary = {
  repo_name: string;
  project_path: string;
  total: number;
  by_state: Record<string, number>;
};

export function registerRoutes(app: FastifyInstance) {
  app.get('/api/sessions', async (req) => {
    const q = (req.query ?? {}) as { status?: string; repo?: string; q?: string };
    const rows = listSessions({ status: q.status, repo: q.repo, q: q.q });
    return { sessions: viewAll(rows) };
  });

  app.get('/api/repos', async () => {
    const rows = listSessions({ status: 'all' });
    const running = listRunningCwds();
    const byRepo = new Map<string, RepoSummary>();
    for (const r of rows) {
      let summary = byRepo.get(r.repo_name);
      if (!summary) {
        summary = { repo_name: r.repo_name, project_path: r.project_path, total: 0, by_state: {} };
        byRepo.set(r.repo_name, summary);
      }
      summary.total++;
      const state = toView(r, running).derived_state;
      summary.by_state[state] = (summary.by_state[state] ?? 0) + 1;
    }
    return { repos: [...byRepo.values()].sort((a, b) => b.total - a.total) };
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const row = getSession(req.params.id);
    if (!row) {
      reply.code(404);
      return { error: 'not found' };
    }
    const running = listRunningCwds();
    const view = toView(row, running);
    const events = row.jsonl_path && existsSync(row.jsonl_path)
      ? await readLastEvents(row.jsonl_path, 50)
      : [];
    return { session: view, events };
  });

  app.patch<{
    Params: { id: string };
    Body: { user_status?: 'active' | 'done' | 'archived'; title?: string | null; notes?: string | null };
  }>('/api/sessions/:id', async (req, reply) => {
    const row = getSession(req.params.id);
    if (!row) {
      reply.code(404);
      return { error: 'not found' };
    }
    const { user_status, title, notes } = req.body ?? {};
    if (user_status) setUserStatus(req.params.id, user_status);
    if (title !== undefined) setTitle(req.params.id, title);
    if (notes !== undefined) setNotes(req.params.id, notes);
    const updated = getSession(req.params.id)!;
    return { session: toView(updated, listRunningCwds()) };
  });

  app.post<{
    Body: { project_path: string; resume_id?: string; title?: string };
  }>('/api/sessions/launch', async (req, reply) => {
    const { project_path, resume_id, title } = req.body ?? ({} as any);
    if (!project_path) {
      reply.code(400);
      return { error: 'project_path is required' };
    }

    if (resume_id) {
      const existing = getSession(resume_id);
      if (!existing) {
        reply.code(404);
        return { error: 'session not found' };
      }
      const result = launchSession({
        cwd: existing.project_path,
        kind: 'resume',
        sessionId: resume_id,
      });
      return { ok: true, session_id: resume_id, command: result.command };
    }

    const id = randomUUID();
    const repoName = project_path.split('/').filter(Boolean).pop() ?? project_path;
    const now = Date.now();
    insertLaunchPlaceholderStmt.run({
      id,
      project_path,
      repo_name: repoName,
      title: title ?? null,
      now,
    });
    const result = launchSession({
      cwd: project_path,
      kind: 'new',
      sessionId: id,
      title: title ?? null,
    });
    return { ok: true, session_id: id, command: result.command };
  });

  app.post('/api/scan', async () => {
    await runScanOnce();
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true }));
}

async function readLastEvents(path: string, n: number) {
  try {
    const content = await readFile(path, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const slice = lines.slice(-n);
    const events: unknown[] = [];
    for (const line of slice) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // ignore corrupt lines
      }
    }
    return events;
  } catch {
    return [];
  }
}
