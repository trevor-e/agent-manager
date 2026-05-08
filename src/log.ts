import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';

const logPath = process.env.CM_LOG_PATH ?? resolve(process.cwd(), 'data', 'claude-manager.log');
mkdirSync(dirname(logPath), { recursive: true });

let stream: WriteStream | null = null;
function getStream(): WriteStream {
  if (!stream) stream = createWriteStream(logPath, { flags: 'a' });
  return stream;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(level: LogLevel, src: string, msg: string, extra?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, src, msg, ...(extra ?? {}) };
  const line = JSON.stringify(entry) + '\n';
  try {
    getStream().write(line);
  } catch {
    // best-effort
  }
  const consoleFn = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  consoleFn.write(`[${level}] ${src}: ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`);
}

export const logPathResolved = logPath;
