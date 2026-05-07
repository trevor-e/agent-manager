import type { SessionRow } from '../db.ts';
import { listRunningCwds } from '../db.ts';

export type DerivedState =
  | 'launching'
  | 'working'
  | 'waiting'
  | 'idle'
  | 'stale'
  | 'done'
  | 'archived';

export type SessionView = SessionRow & {
  derived_state: DerivedState;
  display_name: string;
  is_running: boolean;
};

const STALE_AFTER_MS = 1000 * 60 * 60 * 24;
const RECENT_ACTIVITY_MS = 1000 * 60 * 2;

export function deriveState(s: SessionRow, runningCwds: Set<string>): DerivedState {
  if (s.user_status === 'archived') return 'archived';
  if (s.user_status === 'done') return 'done';
  if (s.last_event_type === 'launching') return 'launching';

  const ageMs = Date.now() - s.last_event_at;
  const recentlyActive = ageMs < RECENT_ACTIVITY_MS;
  const cwdHasClaude = runningCwds.has(s.project_path);

  if (recentlyActive) {
    if (s.last_event_type === 'last-prompt') {
      return cwdHasClaude ? 'waiting' : 'idle';
    }
    return 'working';
  }

  if (ageMs > STALE_AFTER_MS) return 'stale';
  return 'idle';
}

export function displayName(s: SessionRow): string {
  if (s.title) return s.title;
  if (s.auto_title) return s.auto_title;
  if (s.last_prompt) return s.last_prompt.slice(0, 80);
  return s.id.slice(0, 8);
}

export function toView(s: SessionRow, runningCwds: Set<string>): SessionView {
  return {
    ...s,
    derived_state: deriveState(s, runningCwds),
    display_name: displayName(s),
    is_running: runningCwds.has(s.project_path),
  };
}

export function viewAll(rows: SessionRow[]): SessionView[] {
  const running = listRunningCwds();
  return rows.map(r => toView(r, running));
}
