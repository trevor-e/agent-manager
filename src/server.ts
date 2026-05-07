import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.ts';
import { registerRoutes } from './api/routes.ts';
import { startScanner, stopScanner } from './scanner/index.ts';
import { agentManager } from './agent/manager.ts';

const app = Fastify({ logger: false });

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

app.listen({ port: config.port, host: '127.0.0.1' }).then(() => {
  process.stdout.write(`claude-manager listening at http://localhost:${config.port}\n`);
  process.stdout.write(`scanning ${config.projectsDir} every ${config.scanIntervalMs}ms\n`);
  startScanner();
});

const shutdown = (sig: string) => {
  process.stdout.write(`\nreceived ${sig}, shutting down\n`);
  stopScanner();
  agentManager.stopAll();
  app.close().finally(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
