import type { FastifyInstance } from 'fastify';
import { getSession, getLaunchOptions, setLaunchOptions, setUserStatus } from '../../db.ts';
import type { PermissionMode } from '../../shared/types.ts';
import type { UserContentBlock } from '../../agent/types.ts';
import { agentManager } from '../../agent/manager.ts';
import type { AgentEvent } from '../../agent/process.ts';
import { PERMISSION_MODES } from '../../shared/constants.ts';

export function registerAgentRoutes(app: FastifyInstance) {
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
      // On exit/error the manager entry is gone; end the stream so the
      // browser's EventSource reconnects and the fresh attach respawns the
      // agent (--resume). Leaving the socket open strands the client on a
      // dead entry where every send 409s until a hard refresh.
      const listener = (ev: AgentEvent) => {
        send(ev);
        if (ev.type === 'exit' || ev.type === 'error') {
          try {
            reply.raw.end();
          } catch {}
        }
      };
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

  app.post<{
    Params: { id: string };
    Body: {
      content: string;
      images?: Array<{ mediaType: string; data: string }>;
    };
  }>(
    '/api/sessions/:id/messages',
    { bodyLimit: 25 * 1024 * 1024 },
    async (req, reply) => {
      const session = getSession(req.params.id);
      if (!session) {
        reply.code(404);
        return { error: 'session not found' };
      }
      const text = (req.body?.content ?? '').toString();
      const images = Array.isArray(req.body?.images) ? req.body!.images! : [];
      if (!text.trim() && images.length === 0) {
        reply.code(400);
        return { error: 'content or images required' };
      }
      let proc = agentManager.get(session.id);
      if (!proc || !proc.isAlive()) {
        // Agent was parked (idle timeout, restart, server bounce) — respawn
        // it with --resume rather than bouncing the message.
        proc = agentManager.ensure({ sessionId: session.id, cwd: session.project_path });
      }
      if (session.user_status !== 'active') setUserStatus(session.id, 'active');
      if (images.length === 0) {
        await proc.sendUserMessage(text);
      } else {
        const blocks: UserContentBlock[] = [];
        for (const img of images) {
          if (!img || typeof img.mediaType !== 'string' || typeof img.data !== 'string') continue;
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          });
        }
        if (text.trim()) blocks.push({ type: 'text', text });
        await proc.sendUserMessage(blocks);
      }
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
    proc.stop('user');
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { path: string };
  }>('/api/sessions/:id/add-dir', async (req, reply) => {
    const session = getSession(req.params.id);
    if (!session) {
      reply.code(404);
      return { error: 'session not found' };
    }
    const dirPath = req.body?.path?.trim();
    if (!dirPath) {
      reply.code(400);
      return { error: 'path is required' };
    }
    const opts = getLaunchOptions(req.params.id) ?? {};
    const dirs = new Set(opts.addDirs ?? []);
    if (dirs.has(dirPath)) {
      return { ok: true, restarted: false };
    }
    dirs.add(dirPath);
    opts.addDirs = [...dirs];
    setLaunchOptions(req.params.id, opts);

    const proc = agentManager.get(req.params.id);
    if (proc && proc.isAlive()) {
      proc.stop('restart');
    }
    return { ok: true, restarted: true };
  });
}
