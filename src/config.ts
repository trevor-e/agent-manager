import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const config = {
  port: Number(process.env.CM_PORT ?? 7777),
  projectsDir: process.env.CM_PROJECTS_DIR ?? resolve(homedir(), '.claude', 'projects'),
  dbPath: process.env.CM_DB_PATH ?? resolve(process.cwd(), 'data', 'claude-manager.db'),
  launcher: (process.env.CM_LAUNCHER ?? 'ghostty') as 'ghostty',
  scanIntervalMs: Number(process.env.CM_SCAN_INTERVAL_MS ?? 5000),
  claudeBin: process.env.CM_CLAUDE_BIN ?? resolve(homedir(), '.local', 'bin', 'claude'),
  // 30 min: parked agents respawn transparently via --resume, so the timeout
  // only trades memory for resume latency — err toward fewer restarts.
  agentIdleTimeoutMs: Number(process.env.CM_AGENT_IDLE_TIMEOUT_MS ?? 1_800_000),
  linearApiKey: process.env.CM_LINEAR_API_KEY ?? '',
};
