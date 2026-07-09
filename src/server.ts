import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.ts';
import { isAllowedHost } from './api/hostGuard.ts';
import { registerRoutes } from './api/routes.ts';
import { startScanner, stopScanner } from './scanner/index.ts';
import { agentManager } from './agent/manager.ts';
import { killOrphanedAgents } from './agent/cleanup.ts';
import { seedBuiltinWorkflows } from './workflows/seed.ts';
import { resolveShellPath } from './shellPath.ts';
import { log, logPathResolved } from './log.ts';

process.on('uncaughtException', err => {
  log('error', 'process', 'uncaughtException', { message: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log('error', 'process', 'unhandledRejection', { message: err.message, stack: err.stack });
});

const app = Fastify({ logger: false });

// DNS-rebinding guard — see hostGuard.ts.
app.addHook('onRequest', async (req, reply) => {
  if (!isAllowedHost(req.headers.host)) {
    log('warn', 'http', `rejected request with non-local Host header`, { host: req.headers.host });
    reply.code(403).send({ error: 'forbidden host' });
  }
});

app.addHook('onResponse', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return;
  if (req.url === '/api/log') return;
  const level = reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info';
  log(level, 'http', `${req.method} ${req.url} -> ${reply.statusCode}`, {
    ms: Math.round(reply.elapsedTime),
  });
});

app.setErrorHandler((err, req, reply) => {
  log('error', 'http', `${req.method} ${req.url} threw`, {
    message: err.message,
    stack: err.stack,
  });
  if (!reply.sent) reply.code(500).send({ error: err.message });
});

seedBuiltinWorkflows();

registerRoutes(app);

const distDir = resolve(process.cwd(), 'dist');
if (existsSync(distDir)) {
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({
    error: 'frontend not built',
    hint: 'Run `npm run build:web` (or `npm run dev:web` to use the Vite dev server at :5173).',
  }));
}

// Web-chat agents inherit the server's environment (see agent/process.ts), so
// ambient credentials silently change how they authenticate/bill vs. the
// user's interactive claude. Surface that at startup rather than scrubbing —
// a user who exports these probably means for claude to use them.
const ambientCreds = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'].filter(
  k => process.env[k]
);
if (ambientCreds.length > 0) {
  log('warn', 'server', `web-chat agents will inherit ${ambientCreds.join(', ')} from the server environment and may authenticate/bill differently than your terminal sessions`);
}

function probeClaudeBinary() {
  execFile(config.claudeBin, ['--version'], { timeout: 10_000 }, (err, stdout) => {
    if (err) {
      log('error', 'server', `claude binary probe failed — agent launches will not work`, {
        bin: config.claudeBin,
        message: err.message,
      });
    } else {
      log('info', 'server', `claude binary ok: ${stdout.trim()}`, { bin: config.claudeBin });
    }
  });
}

// Reap leftover agents from a prior run before accepting connections —
// otherwise a reconnecting client can spawn a fresh agent mid-scan and the
// cleanup SIGTERMs it as an "orphan".
const killed = await killOrphanedAgents(agentManager.ownedPids());
if (killed > 0) log('info', 'server', `cleaned up ${killed} orphaned agent(s)`);

app.listen({ port: config.port, host: '127.0.0.1' }).then(async () => {
  log('info', 'server', `listening at http://localhost:${config.port}`, { logFile: logPathResolved });
  probeClaudeBinary();
  await resolveShellPath();
  log('info', 'server', `scanning ${config.projectsDir} every ${config.scanIntervalMs}ms`);
  startScanner();
});

const shutdown = (sig: string) => {
  log('info', 'server', `received ${sig}, shutting down`);
  stopScanner();
  agentManager.stopAll();
  app.close().finally(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
