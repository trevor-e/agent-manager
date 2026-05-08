import { navigate } from '../App';
import type { Session } from '../types';
import { useNow } from '../useNow';
import { rememberSlotNav } from '../sessionSlots';
import { formatCost, usageTooltip } from '../format';

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

function SidebarItem({
  session,
  showRepo,
  slot,
  fromSessionId,
}: {
  session: Session;
  showRepo: boolean;
  slot: number | undefined;
  fromSessionId: string;
}) {
  const badge = STATE_BADGES[session.derived_state] ?? STATE_BADGES.idle;
  const now = useNow();
  return (
    <a
      className="sidebar-item"
      href={`/sessions/${session.id}`}
      onClick={e => {
        e.preventDefault();
        if (slot !== undefined) {
          rememberSlotNav(fromSessionId, session.id, slot);
        }
        navigate(`/sessions/${session.id}`);
      }}
      title={session.display_name}
    >
      <div className="sidebar-item-title">{session.display_name}</div>
      <div className="sidebar-item-meta muted small">
        {slot !== undefined ? (
          <kbd className="sidebar-item-kbd">⌘{slot}</kbd>
        ) : (
          <span className="sidebar-item-kbd-placeholder" />
        )}
        <span className={badge.cls + ' state-badge'}>{badge.label}</span>
        {showRepo && <span className="sidebar-item-repo">{session.repo_name}</span>}
        {session.git_branch && (
          <span className="sidebar-item-branch">{session.git_branch}</span>
        )}
        <span className="sidebar-item-age">{ageStr(now, session.last_event_at)}</span>
        {session.usage && session.usage.totalTokens > 0 && (
          <span className="sidebar-item-cost" title={usageTooltip(session.usage)}>
            {formatCost(session.usage.costUSD)}
          </span>
        )}
      </div>
    </a>
  );
}

function sortByDisplay(items: Session[], slotBySessionId: Map<string, number>): Session[] {
  return [...items].sort((a, b) => {
    const sa = slotBySessionId.get(a.id);
    const sb = slotBySessionId.get(b.id);
    if (sa !== undefined && sb !== undefined) return sa - sb;
    if (sa !== undefined) return -1;
    if (sb !== undefined) return 1;
    return b.last_event_at - a.last_event_at;
  });
}

export function SessionSidebar({
  currentSessionId,
  currentRepoName,
  sessions,
  loaded,
  slotBySessionId,
}: {
  currentSessionId: string;
  currentRepoName: string;
  sessions: Session[];
  loaded: boolean;
  slotBySessionId: Map<string, number>;
}) {
  const others = sessions.filter(s => s.id !== currentSessionId);
  const sameRepo = sortByDisplay(
    others.filter(s => s.repo_name === currentRepoName),
    slotBySessionId
  );
  const otherRepo = sortByDisplay(
    others.filter(s => s.repo_name !== currentRepoName),
    slotBySessionId
  );

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
            <SidebarItem
              key={s.id}
              session={s}
              showRepo={false}
              slot={slotBySessionId.get(s.id)}
              fromSessionId={currentSessionId}
            />
          ))}
        </div>
      )}
      {otherRepo.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-group-label">Other repos</div>
          {otherRepo.map(s => (
            <SidebarItem
              key={s.id}
              session={s}
              showRepo
              slot={slotBySessionId.get(s.id)}
              fromSessionId={currentSessionId}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

export function sortSidebarSessions(
  currentSessionId: string,
  currentRepoName: string,
  sessions: Session[]
): Session[] {
  const others = sessions.filter(s => s.id !== currentSessionId);
  const sameRepo = others
    .filter(s => s.repo_name === currentRepoName)
    .sort((a, b) => b.last_event_at - a.last_event_at);
  const otherRepo = others
    .filter(s => s.repo_name !== currentRepoName)
    .sort((a, b) => b.last_event_at - a.last_event_at);
  return [...sameRepo, ...otherRepo];
}
