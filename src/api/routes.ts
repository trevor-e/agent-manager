import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  listSessions,
  getSession,
  setUserStatus,
  setTitle,
  insertLaunchPlaceholderStmt,
  db,
  type LaunchOptions,
} from '../db.ts';
import type { PermissionMode } from '../agent/types.ts';
import { runScanOnce } from '../scanner/index.ts';
import { launchSession } from '../launcher/terminal.ts';
import {
  viewAll,
  toView,
  attachUsage,
  runningCwdsExcludingOwn,
  lockedSessionIdsExcludingOwn,
  type SessionView,
} from './state.ts';
import { computeUsage } from '../scanner/usage.ts';
import { agentManager } from '../agent/manager.ts';
import type { AgentEvent } from '../agent/process.ts';
import { log, type LogLevel } from '../log.ts';
import { getBranchChanges, getWorkingChanges } from './git.ts';

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

  app.post('/api/scan', async () => {
    await runScanOnce();
    return { ok: true };
  });

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

  // ---- Agent (web chat) endpoints ----

  app.get<{ Params: { id: string } }>('/api/sessions/:id/stream', async (req, reply) => {
    const session = getSession(req.params.id);
    if (!session) {
      reply.code(404).send({ error: 'session not found' });
      return;
    }

    // Tell fastify we're handling the response ourselves; without this its
    // error handler will try to reply.send() on any throw, hitting writeHead
    // a second time and crashing the process with ERR_HTTP_HEADERS_SENT.
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (ev: unknown) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {
        // socket closed mid-write
      }
    };

    let handle: ReturnType<typeof agentManager.attach>;
    try {
      const listener = (ev: AgentEvent) => send(ev);
      handle = agentManager.attach(
        { sessionId: session.id, cwd: session.project_path },
        listener
      );
    } catch (err) {
      send({ type: 'stderr', line: `agent attach failed: ${(err as Error).message}` });
      reply.raw.end();
      return;
    }

    send({ type: 'attached', pendingApprovals: handle.pendingApprovals() });
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch {}
    }, 15_000);

    const close = () => {
      clearInterval(heartbeat);
      handle.detach();
    };
    req.raw.on('close', close);
    req.raw.on('error', close);
  });

  app.post<{ Params: { id: string }; Body: { content: string } }>(
    '/api/sessions/:id/messages',
    async (req, reply) => {
      const session = getSession(req.params.id);
      if (!session) {
        reply.code(404);
        return { error: 'session not found' };
      }
      const content = (req.body?.content ?? '').toString();
      if (!content.trim()) {
        reply.code(400);
        return { error: 'content is required' };
      }
      const proc = agentManager.get(session.id);
      if (!proc || !proc.isAlive()) {
        reply.code(409);
        return { error: 'no live agent; open the session in the dashboard first' };
      }
      await proc.sendUserMessage(content);
      return { ok: true };
    }
  );

  app.post<{
    Params: { id: string; approvalId: string };
    Body: { decision: 'approve' | 'deny'; reason?: string; updatedInput?: unknown };
  }>('/api/sessions/:id/approvals/:approvalId', async (req, reply) => {
    const proc = agentManager.get(req.params.id);
    if (!proc) {
      reply.code(404);
      return { error: 'no live agent' };
    }
    const decision = req.body?.decision;
    if (decision !== 'approve' && decision !== 'deny') {
      reply.code(400);
      return { error: 'decision must be approve or deny' };
    }
    const ok = proc.resolveApproval(req.params.approvalId, decision, {
      reason: req.body?.reason,
      updatedInput: req.body?.updatedInput,
    });
    if (!ok) {
      reply.code(404);
      return { error: 'unknown approvalId' };
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/interrupt', async (req, reply) => {
    const proc = agentManager.get(req.params.id);
    if (!proc) {
      reply.code(404);
      return { error: 'no live agent' };
    }
    await proc.interrupt();
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { mode?: string };
  }>('/api/sessions/:id/permission-mode', async (req, reply) => {
    const proc = agentManager.get(req.params.id);
    if (!proc || !proc.isAlive()) {
      reply.code(404);
      return { error: 'no live agent' };
    }
    const mode = req.body?.mode;
    if (typeof mode !== 'string' || !PERMISSION_MODES.has(mode)) {
      reply.code(400);
      return { error: 'invalid permission mode' };
    }
    await proc.setPermissionMode(mode as PermissionMode);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/stop', async (req, reply) => {
    const proc = agentManager.get(req.params.id);
    if (!proc) {
      reply.code(404);
      return { error: 'no live agent' };
    }
    proc.stop();
    return { ok: true };
  });
}


const PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'auto',
  'dontAsk',
]);
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

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
