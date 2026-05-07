import { config } from '../config.ts';
import { scanJsonl } from './jsonl.ts';
import { scanProcesses } from './processes.ts';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  const t0 = Date.now();
  try {
    const [jsonl, procs] = await Promise.all([scanJsonl(), scanProcesses()]);
    const dt = Date.now() - t0;
    process.stdout.write(
      `[scan ${dt}ms] jsonl: ${jsonl.scanned} scanned / ${jsonl.updated} updated, processes: ${procs.length}\n`
    );
  } catch (err) {
    process.stderr.write(`[scan-error] ${(err as Error).message}\n`);
  } finally {
    running = false;
  }
}

export function startScanner() {
  void tick();
  timer = setInterval(tick, config.scanIntervalMs);
}

export function stopScanner() {
  if (timer) clearInterval(timer);
  timer = null;
}

export { tick as runScanOnce };
