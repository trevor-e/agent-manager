import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../log.ts';

const execFileP = promisify(execFile);

export async function killOrphanedAgents(): Promise<number> {
  let stdout = '';
  try {
    const r = await execFileP('/bin/ps', ['-axwwE'], {
      maxBuffer: 8 * 1024 * 1024,
    });
    stdout = r.stdout;
  } catch {
    return 0;
  }

  let killed = 0;
  for (const line of stdout.split('\n')) {
    if (!line.includes('CLAUDE_MANAGER_AGENT=1')) continue;
    const m = line.match(/^\s*(\d+)\s/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
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
