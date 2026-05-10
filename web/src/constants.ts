export const STATE_BADGES: Record<string, { label: string; cls: string }> = {
  launching: { label: 'launching', cls: 'badge badge-launching' },
  working: { label: 'working', cls: 'badge badge-working' },
  waiting: { label: 'waiting', cls: 'badge badge-waiting' },
  blocked: { label: 'blocked', cls: 'badge badge-blocked' },
  idle: { label: 'idle', cls: 'badge badge-idle' },
  done: { label: 'done', cls: 'badge badge-done' },
  archived: { label: 'archived', cls: 'badge badge-archived' },
};

export const STATE_LABELS: Record<string, string> = {
  launching: '🚀 launching',
  working: '🟢 working',
  waiting: '🟡 waiting on you',
  blocked: '🔴 needs approval',
  idle: '⚪ idle',
  stale: '🌫 stale',
  done: '✅ done',
  archived: '📦 archived',
};

export function ageStr(now: number, ms: number): string {
  const d = now - ms;
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}
