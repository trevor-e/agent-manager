import type { SessionRow } from '../db.ts';
import { listRunningCwds, db } from '../db.ts';
import { agentManager } from '../agent/manager.ts';
import { computeUsage } from '../scanner/usage.ts';
import type { DerivedState, UsageTotals } from '../shared/types.ts';

export type { DerivedState } from '../shared/types.ts';

export type SessionView = SessionRow & {
  derived_state: DerivedState;
  display_name: string;
  is_running: boolean;
  web_chat_locked: boolean;
  usage?: UsageTotals | null;
  tool_usage?: Record<string, number> | null;
};

const RECENT_ACTIVITY_MS = 1000 * 60 * 2;

export function deriveState(s: SessionRow, runningCwds: Set<string>): DerivedState {
  if (s.user_status === 'archived') return 'archived';
  if (s.user_status === 'done') return 'done';
  if (s.last_event_type === 'launching') return 'launching';

  // Live web-chat agents know their own state — prefer it over JSONL inference.
  const agentStatus = agentManager.statusFor(s.id);
  if (agentStatus === 'awaiting_approval') return 'blocked';
  if (agentStatus === 'working') return 'working';
  if (agentStatus === 'awaiting_input') return 'waiting';

  const ageMs = Date.now() - s.last_event_at;
  const cwdHasClaude = runningCwds.has(s.project_path);

  if (ageMs < RECENT_ACTIVITY_MS) {
    if (s.last_event_type === 'last-prompt') {
      return cwdHasClaude ? 'waiting' : 'idle';
    }
    return 'working';
  }

  return 'idle';
}

export function displayName(s: SessionRow): string {
  if (s.title) return s.title;
  if (s.auto_title) return s.auto_title;
  if (s.last_prompt) return s.last_prompt.slice(0, 80);
  return s.id.slice(0, 8);
}

export function toView(s: SessionRow, runningCwds: Set<string>, lockedSessionIds: Set<string>): SessionView {
  return {
    ...s,
    derived_state: deriveState(s, runningCwds),
    display_name: displayName(s),
    is_running: runningCwds.has(s.project_path),
    web_chat_locked: lockedSessionIds.has(s.id),
  };
}

export function viewAll(rows: SessionRow[]): SessionView[] {
  const running = runningCwdsExcludingOwn();
  const locked = lockedSessionIdsExcludingOwn();
  return rows.map(r => toView(r, running, locked));
}

export async function attachUsage(views: SessionView[]): Promise<SessionView[]> {
  await Promise.all(
    views.map(async v => {
      if (!v.jsonl_path) return;
      v.usage = await computeUsage(v.jsonl_path);
    })
  );
  return views;
}

export function lockedSessionIdsExcludingOwn(): Set<string> {
  const ownedPids = agentManager.ownedPids();
  const rows = db
    .prepare('SELECT pid, session_id FROM running_processes WHERE session_id IS NOT NULL')
    .all() as { pid: number; session_id: string }[];
  const ids = new Set<string>();
  for (const r of rows) {
    if (!ownedPids.has(r.pid)) ids.add(r.session_id);
  }
  return ids;
}

export function runningCwdsExcludingOwn(): Set<string> {
  const ownedPids = agentManager.ownedPids();
  const ownedCwds = agentManager.ownedCwds();
  const rows = db
    .prepare('SELECT pid, cwd FROM running_processes')
    .all() as { pid: number; cwd: string }[];
  const cwds = new Set<string>();
  for (const r of rows) {
    if (ownedPids.has(r.pid)) continue;
    cwds.add(r.cwd);
  }
  // If our agent is alive in cwd X but no other claude is, we DO want to remove it
  // from the set so the warning chip stays off. The pid filter above handles that
  // for the running-claude case; ownedCwds is a fallback for the brief window where
  // our spawn has happened but the scanner hasn't recorded the new pid yet.
  for (const cwd of ownedCwds) {
    // Only drop if pid filter isn't already excluding it; safe to drop unconditionally
    // because we don't want to scare users about their own agent.
    cwds.delete(cwd);
  }
  return cwds;
}
