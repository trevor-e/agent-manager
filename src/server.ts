import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.ts';
import { registerRoutes } from './api/routes.ts';
import { startScanner, stopScanner } from './scanner/index.ts';
import { agentManager } from './agent/manager.ts';
import { killOrphanedAgents } from './agent/cleanup.ts';
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

app.listen({ port: config.port, host: '127.0.0.1' }).then(async () => {
  log('info', 'server', `listening at http://localhost:${config.port}`, { logFile: logPathResolved });
  const killed = await killOrphanedAgents();
  if (killed > 0) log('info', 'server', `cleaned up ${killed} orphaned agent(s)`);
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
