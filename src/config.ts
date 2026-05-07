import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const config = {
  port: Number(process.env.CM_PORT ?? 7777),
  projectsDir: process.env.CM_PROJECTS_DIR ?? resolve(homedir(), '.claude', 'projects'),
  dbPath: process.env.CM_DB_PATH ?? resolve(process.cwd(), 'data', 'claude-manager.db'),
  launcher: (process.env.CM_LAUNCHER ?? 'ghostty') as 'ghostty',
  scanIntervalMs: Number(process.env.CM_SCAN_INTERVAL_MS ?? 5000),
};
