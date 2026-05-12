import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import { config } from '../../config.ts';

export type McpServer = {
  name: string;
  url: string;
  status: 'connected' | 'needs_auth' | 'failed';
};

function parseMcpList(output: string): McpServer[] {
  const servers: McpServer[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^(.+?):\s+(https?:\/\/\S+).*\s-\s+(.+)$/);
    if (!match) continue;
    const [, name, url, statusText] = match;
    let status: McpServer['status'] = 'failed';
    if (statusText.includes('Connected')) status = 'connected';
    else if (statusText.includes('Needs authentication')) status = 'needs_auth';
    servers.push({ name: name.trim(), url, status });
  }
  return servers;
}

function runMcpList(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.claudeBin, ['mcp', 'list'], {
      cwd,
      timeout: 30_000,
      env: { ...process.env },
    });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (out += d.toString()));
    proc.on('close', () => resolve(out));
    proc.on('error', reject);
  });
}

export function registerMcpRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { cwd?: string } }>('/api/mcp', async (req) => {
    const cwd = req.query.cwd || process.cwd();
    const output = await runMcpList(cwd);
    return { servers: parseMcpList(output) };
  });
}
