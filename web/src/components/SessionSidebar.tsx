import { useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../App';
import type { Session } from '../types';
import { useNow } from '../useNow';

const STATE_BADGES: Record<string, { label: string; cls: string }> = {
  launching: { label: 'launching', cls: 'badge badge-launching' },
  working: { label: 'working', cls: 'badge badge-working' },
  waiting: { label: 'waiting', cls: 'badge badge-waiting' },
  blocked: { label: 'blocked', cls: 'badge badge-blocked' },
  idle: { label: 'idle', cls: 'badge badge-idle' },
  done: { label: 'done', cls: 'badge badge-done' },
  archived: { label: 'archived', cls: 'badge badge-archived' },
};

function ageStr(now: number, ms: number): string {
  const d = now - ms;
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

function SidebarItem({ session, showRepo }: { session: Session; showRepo: boolean }) {
  const badge = STATE_BADGES[session.derived_state] ?? STATE_BADGES.idle;
  const now = useNow();
  return (
    <a
      className="sidebar-item"
      href={`/sessions/${session.id}`}
      onClick={e => {
        e.preventDefault();
        navigate(`/sessions/${session.id}`);
      }}
      title={session.display_name}
    >
      <span className={badge.cls + ' state-badge'}>{badge.label}</span>
      <div className="sidebar-item-body">
        <div className="sidebar-item-title">{session.display_name}</div>
        <div className="sidebar-item-meta muted small">
          {showRepo && <span className="sidebar-item-repo">{session.repo_name}</span>}
          <span>{ageStr(now, session.last_event_at)}</span>
        </div>
      </div>
    </a>
  );
}

export function SessionSidebar({
  currentSessionId,
  currentRepoName,
}: {
  currentSessionId: string;
  currentRepoName: string;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await api.listSessions({ status: 'active' });
        if (!cancelled) {
          setSessions(r.sessions);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    refresh();
    const t = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const others = sessions.filter(s => s.id !== currentSessionId);
  const sameRepo = others
    .filter(s => s.repo_name === currentRepoName)
    .sort((a, b) => b.last_event_at - a.last_event_at);
  const otherRepo = others
    .filter(s => s.repo_name !== currentRepoName)
    .sort((a, b) => b.last_event_at - a.last_event_at);

  return (
    <aside className="session-sidebar">
      <div className="sidebar-header">
        <span>Active sessions</span>
        <span className="muted small">{others.length}</span>
      </div>
      {!loaded && <div className="muted small sidebar-empty">loading…</div>}
      {loaded && others.length === 0 && (
        <div className="muted small sidebar-empty">No other active sessions</div>
      )}
      {sameRepo.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-group-label">{currentRepoName}</div>
          {sameRepo.map(s => (
            <SidebarItem key={s.id} session={s} showRepo={false} />
          ))}
        </div>
      )}
      {otherRepo.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-group-label">Other repos</div>
          {otherRepo.map(s => (
            <SidebarItem key={s.id} session={s} showRepo />
          ))}
        </div>
      )}
    </aside>
  );
}
