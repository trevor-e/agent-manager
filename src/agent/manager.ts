import { AgentProcess, type AgentEvent, type AgentStatus } from './process.ts';
import { config } from '../config.ts';

type Entry = {
  process: AgentProcess;
  listeners: Set<(ev: AgentEvent) => void>;
  idleTimer: NodeJS.Timeout | null;
  recentEvents: AgentEvent[];
};

const RECENT_EVENT_BUFFER = 200;

class AgentManager {
  private entries = new Map<string, Entry>();

  attach(opts: { sessionId: string; cwd: string }, listener: (ev: AgentEvent) => void) {
    let entry = this.entries.get(opts.sessionId);
    if (!entry) {
      const process = new AgentProcess({ sessionId: opts.sessionId, cwd: opts.cwd });
      entry = { process, listeners: new Set(), idleTimer: null, recentEvents: [] };
      this.entries.set(opts.sessionId, entry);
      process.on('event', (ev: AgentEvent) => {
        entry!.recentEvents.push(ev);
        if (entry!.recentEvents.length > RECENT_EVENT_BUFFER) {
          entry!.recentEvents.splice(0, entry!.recentEvents.length - RECENT_EVENT_BUFFER);
        }
        for (const l of entry!.listeners) l(ev);
        if (ev.type === 'exit') this.cleanup(opts.sessionId);
      });
      process.start();
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.listeners.add(listener);
    for (const ev of entry.recentEvents) listener(ev);
    return {
      detach: () => this.detach(opts.sessionId, listener),
      pendingApprovals: () => entry!.process.listPendingApprovals(),
    };
  }

  detach(sessionId: string, listener: (ev: AgentEvent) => void) {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.idleTimer = setTimeout(() => {
        const e = this.entries.get(sessionId);
        if (e && e.listeners.size === 0) {
          e.process.stop();
        }
      }, config.agentIdleTimeoutMs);
      entry.idleTimer.unref?.();
    }
  }

  get(sessionId: string): AgentProcess | undefined {
    return this.entries.get(sessionId)?.process;
  }

  has(sessionId: string) {
    return this.entries.has(sessionId);
  }

  statusFor(sessionId: string): AgentStatus | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry || !entry.process.isAlive()) return undefined;
    return entry.process.status;
  }

  ownedPids(): Set<number> {
    const pids = new Set<number>();
    for (const entry of this.entries.values()) {
      const pid = entry.process.pid();
      if (pid != null) pids.add(pid);
    }
    return pids;
  }

  ownedCwds(): Set<string> {
    const cwds = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.process.isAlive()) cwds.add(entry.process.cwd);
    }
    return cwds;
  }

  stopAll() {
    for (const entry of this.entries.values()) {
      entry.process.stop();
    }
    this.entries.clear();
  }

  private cleanup(sessionId: string) {
    const entry = this.entries.get(sessionId);
    if (entry?.idleTimer) clearTimeout(entry.idleTimer);
    this.entries.delete(sessionId);
  }
}

export const agentManager = new AgentManager();
