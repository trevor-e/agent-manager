import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { replaceRunningProcesses, type ProcessRow } from '../db.ts';

const execFileP = promisify(execFile);

const PS_BIN = '/bin/ps';
const LSOF_BIN = '/usr/sbin/lsof';

const ETIME_RE = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/;

export function etimeToMs(etime: string): number {
  const m = etime.trim().match(ETIME_RE);
  if (!m) return 0;
  const [, days, hours, mins, secs] = m;
  return (
    (Number(days || 0) * 86400 +
      Number(hours || 0) * 3600 +
      Number(mins || 0) * 60 +
      Number(secs || 0)) *
    1000
  );
}

async function getCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileP(LSOF_BIN, ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const line of stdout.split('\n')) {
      if (line.startsWith('n')) return line.slice(1);
    }
  } catch {
    // process may have exited
  }
  return null;
}

const JSONL_RE = /\/\.claude\/projects\/[^/]+\/([0-9a-f-]{32,})\.jsonl$/;

async function getOpenSessionId(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileP(LSOF_BIN, ['-p', String(pid), '-Fn'], {
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const line of stdout.split('\n')) {
      if (!line.startsWith('n')) continue;
      const m = line.slice(1).match(JSONL_RE);
      if (m) return m[1];
    }
  } catch {
    // process may have exited
  }
  return null;
}

export async function scanProcesses(): Promise<ProcessRow[]> {
  let stdout = '';
  try {
    const r = await execFileP(PS_BIN, ['-axwwo', 'pid=,etime=,command='], {
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = r.stdout;
  } catch {
    return [];
  }

  const candidates: { pid: number; etime: string }[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const etime = m[2];
    const command = m[3];
    if (!isClaudeProcess(command)) continue;
    candidates.push({ pid, etime });
  }

  const now = Date.now();
  const results = await Promise.all(
    candidates.map(async ({ pid, etime }) => {
      const [cwd, sessionId] = await Promise.all([getCwd(pid), getOpenSessionId(pid)]);
      if (!cwd) return null;
      const startedAt = now - etimeToMs(etime);
      return {
        pid,
        cwd,
        session_id: sessionId,
        started_at: startedAt,
        observed_at: now,
      } satisfies ProcessRow;
    })
  );
  const rows = results.filter((r): r is ProcessRow => r !== null);
  replaceRunningProcesses(rows);
  return rows;
}

export function isClaudeProcess(command: string): boolean {
  const head = command.split(/\s+/, 1)[0] ?? '';
  const exe = head.split('/').pop() ?? head;
  return exe === 'claude';
}
