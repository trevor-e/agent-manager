import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  db,
  listSessions,
  getSession,
  setUserStatus,
  setTitle,
  insertLaunchPlaceholderStmt,
  type LaunchOptions,
} from '../../db.ts';
import { runScanOnce } from '../../scanner/index.ts';
import { launchSession } from '../../launcher/terminal.ts';
import {
  viewAll,
  toView,
  attachUsage,
  runningCwdsExcludingOwn,
  lockedSessionIdsExcludingOwn,
} from '../state.ts';
import { computeUsage } from '../../scanner/usage.ts';
import { computeToolUsage } from '../../scanner/tools.ts';

type RepoSummary = {
  repo_name: string;
  project_path: string;
  total: number;
  by_state: Record<string, number>;
};

export const PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'auto',
  'dontAsk',
]);
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export function registerSessionRoutes(app: FastifyInstance) {
  app.get('/api/sessions', async (req) => {
    const q = (req.query ?? {}) as { status?: string; repo?: string; q?: string };
    const rows = listSessions({ status: q.status, repo: q.repo, q: q.q });
    const views = await attachUsage(viewAll(rows));
    return { sessions: views };
  });

  app.get('/api/repos', async () => {
    const rows = listSessions({ status: 'all' });
    const running = runningCwdsExcludingOwn();
    const locked = lockedSessionIdsExcludingOwn();
    const byRepo = new Map<string, RepoSummary>();
    for (const r of rows) {
      let summary = byRepo.get(r.repo_name);
      if (!summary) {
        summary = { repo_name: r.repo_name, project_path: r.project_path, total: 0, by_state: {} };
        byRepo.set(r.repo_name, summary);
      }
      summary.total++;
      const state = toView(r, running, locked).derived_state;
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
    const running = runningCwdsExcludingOwn();
    const locked = lockedSessionIdsExcludingOwn();
    const view = toView(row, running, locked);
    if (row.jsonl_path) {
      view.usage = await computeUsage(row.jsonl_path);
      view.tool_usage = await computeToolUsage(row.jsonl_path);
    }
    const events = row.jsonl_path && existsSync(row.jsonl_path)
      ? await readLastEvents(row.jsonl_path, 50)
      : [];
    return { session: view, events };
  });

  app.patch<{
    Params: { id: string };
    Body: { user_status?: 'active' | 'done' | 'archived'; title?: string | null };
  }>('/api/sessions/:id', async (req, reply) => {
    const row = getSession(req.params.id);
    if (!row) {
      reply.code(404);
      return { error: 'not found' };
    }
    const { user_status, title } = req.body ?? {};
    if (user_status) setUserStatus(req.params.id, user_status);
    if (title !== undefined) setTitle(req.params.id, title);
    const updated = getSession(req.params.id)!;
    return { session: toView(updated, runningCwdsExcludingOwn(), lockedSessionIdsExcludingOwn()) };
  });

  app.post<{
    Body: {
      project_path: string;
      resume_id?: string;
      title?: string;
      web_only?: boolean;
      launch_options?: LaunchOptions;
    };
  }>('/api/sessions/launch', async (req, reply) => {
    const { project_path, resume_id, title, web_only, launch_options } =
      req.body ?? ({} as any);
    if (!project_path) {
      reply.code(400);
      return { error: 'project_path is required' };
    }

    const normalized = normalizeLaunchOptions(launch_options);

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
        launchOptions: normalized,
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
      launch_options: normalized ? JSON.stringify(normalized) : null,
      now,
    });
    if (web_only) {
      return { ok: true, session_id: id, command: '(web-only, no terminal launched)' };
    }
    const result = launchSession({
      cwd: project_path,
      kind: 'new',
      sessionId: id,
      title: title ?? null,
      launchOptions: normalized,
    });
    return { ok: true, session_id: id, command: result.command };
  });

  app.post<{
    Params: { id: string };
    Body: {
      web_only?: boolean;
      launch_options?: LaunchOptions;
    };
  }>('/api/sessions/:id/fork', async (req, reply) => {
    const parent = getSession(req.params.id);
    if (!parent) {
      reply.code(404);
      return { error: 'session not found' };
    }
    const id = randomUUID();
    const repoName = parent.project_path.split('/').filter(Boolean).pop() ?? parent.project_path;
    const now = Date.now();
    const normalized = normalizeLaunchOptions(req.body?.launch_options) ?? {};
    normalized.forkFrom = parent.id;
    insertLaunchPlaceholderStmt.run({
      id,
      project_path: parent.project_path,
      repo_name: repoName,
      title: `Fork of ${parent.title ?? parent.auto_title ?? parent.id.slice(0, 8)}`,
      launch_options: JSON.stringify(normalized),
      now,
    });
    db.prepare('UPDATE sessions SET parent_session_id = ? WHERE id = ?').run(parent.id, id);
    const webOnly = req.body?.web_only !== false;
    if (!webOnly) {
      launchSession({
        cwd: parent.project_path,
        kind: 'new',
        sessionId: id,
        title: null,
        launchOptions: normalized,
      });
    }
    return { ok: true, session_id: id };
  });

  app.post('/api/scan', async () => {
    await runScanOnce();
    return { ok: true };
  });
}

function normalizeLaunchOptions(input: unknown): LaunchOptions | null {
  if (!input || typeof input !== 'object') return null;
  const src = input as Record<string, unknown>;
  const out: LaunchOptions = {};
  if (typeof src.permissionMode === 'string' && PERMISSION_MODES.has(src.permissionMode)) {
    out.permissionMode = src.permissionMode as LaunchOptions['permissionMode'];
  }
  if (typeof src.model === 'string' && src.model.trim()) {
    out.model = src.model.trim();
  }
  if (typeof src.effort === 'string' && EFFORT_LEVELS.has(src.effort)) {
    out.effort = src.effort as LaunchOptions['effort'];
  }
  if (Array.isArray(src.addDirs)) {
    const dirs = src.addDirs.filter((d): d is string => typeof d === 'string' && d.trim() !== '');
    if (dirs.length) out.addDirs = dirs.map(d => d.trim());
  }
  if (src.worktree && typeof src.worktree === 'object') {
    const w = src.worktree as Record<string, unknown>;
    if (w.enabled) {
      out.worktree = { enabled: true };
      if (typeof w.name === 'string' && w.name.trim()) {
        out.worktree.name = w.name.trim();
      }
    }
  }
  if (typeof src.systemPrompt === 'string' && src.systemPrompt.trim()) {
    out.systemPrompt = src.systemPrompt.trim();
  }
  if (typeof src.appendSystemPrompt === 'string' && src.appendSystemPrompt.trim()) {
    out.appendSystemPrompt = src.appendSystemPrompt.trim();
  }
  return Object.keys(out).length ? out : null;
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
