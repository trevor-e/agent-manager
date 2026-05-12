import type { FastifyInstance } from 'fastify';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerAgentRoutes } from './routes/agent.ts';
import { registerGitRoutes } from './routes/git.ts';
import { registerLogRoutes } from './routes/log.ts';
import { registerLinearRoutes } from './routes/linear.ts';
import { registerKeyRoutes } from './routes/keys.ts';
import { registerMcpRoutes } from './routes/mcp.ts';

export function registerRoutes(app: FastifyInstance) {
  registerSessionRoutes(app);
  registerAgentRoutes(app);
  registerGitRoutes(app);
  registerLogRoutes(app);
  registerLinearRoutes(app);
  registerKeyRoutes(app);
  registerMcpRoutes(app);
}
