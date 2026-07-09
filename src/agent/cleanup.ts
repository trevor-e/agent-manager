import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../log.ts';

const execFileP = promisify(execFile);

// `except`: pids spawned by the current server — never orphans. Guards the
// race where a client reconnects and spawns a fresh agent before the ps scan
// finishes.
export async function killOrphanedAgents(except: Set<number> = new Set()): Promise<number> {
  let stdout = '';
  try {
    const r = await execFileP('/bin/ps', ['-axww', '-E', '-o', 'pid=,ppid=,command='], {
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = r.stdout;
  } catch {
    return 0;
  }

  let killed = 0;
  for (const line of stdout.split('\n')) {
    if (!line.includes('CLAUDE_MANAGER_AGENT=1')) continue;
    const m = line.match(/^\s*(\d+)\s+(\d+)\s/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (pid === process.pid || except.has(pid)) continue;
    // The marker env var is inherited by every descendant of an agent (its
    // Bash subprocesses included), and a second server instance sees another
    // live server's agents too. Neither is an orphan: orphans are the ones
    // reparented to launchd (ppid 1) after their server died. Reap only those.
    if (ppid !== 1) continue;
    try {
      process.kill(pid, 'SIGTERM');
      killed++;
      log('info', 'cleanup', `killed orphaned agent pid=${pid}`);
    } catch {
      // already dead
    }
  }
  return killed;
}
