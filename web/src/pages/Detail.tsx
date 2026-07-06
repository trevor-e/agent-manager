import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { navigate, useHeaderActionsSlot } from '../App';
import { Composer } from '../components/Composer';
import { GitView } from '../components/GitView';
import { LaunchModal } from '../components/LaunchModal';
import { RepoSelect } from '../components/RepoSelect';
import { SessionSidebar, sortSidebarSessions } from '../components/SessionSidebar';
import { computeSlots, rememberSlotNav } from '../sessionSlots';
import type { RepoSummary, Session, SessionEvent } from '../types';
import { useNow } from '../useNow';
import { contextPercent, formatCost, formatTokens, usageTooltip } from '../format';
import { STATE_LABELS, ageStr } from '../constants';

function isInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function DetailPage({ id }: { id: string }) {
  const [data, setData] = useState<{ session: Session; events: SessionEvent[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [addDirOpen, setAddDirOpen] = useState(false);
  const [addDirValue, setAddDirValue] = useState('');
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [activeLoaded, setActiveLoaded] = useState(false);
  const [view, setView] = useState<'conversation' | 'diff'>('conversation');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const headerActionsSlot = useHeaderActionsSlot();

  useEffect(() => {
    if (!moreOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [moreOpen]);

  async function refresh() {
    try {
      const r = await api.getSession(id);
      setData(r);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    api.repos().then(r => setRepos(r.repos)).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshActive() {
      try {
        const r = await api.listSessions({ status: 'active' });
        if (!cancelled) {
          setActiveSessions(r.sessions);
          setActiveLoaded(true);
        }
      } catch {
        if (!cancelled) setActiveLoaded(true);
      }
    }
    refreshActive();
    const t = setInterval(refreshActive, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const session = data?.session;

  useEffect(() => {
    if (session) document.title = `${session.display_name} — claude-manager`;
    return () => { document.title = 'claude-manager'; };
  }, [session?.display_name]);

  const sortedOthers = useMemo(() => {
    if (!session) return [];
    return sortSidebarSessions(session.id, session.repo_name, activeSessions);
  }, [session, activeSessions]);
  const { slotBySessionId, sessionBySlot } = useMemo(() => {
    if (!session) {
      return {
        slotBySessionId: new Map<string, number>(),
        sessionBySlot: new Map<number, string>(),
      };
    }
    return computeSlots(session.id, sortedOthers);
  }, [session, sortedOthers]);

  async function saveTitle(value: string | null) {
    await api.patchSession(id, { title: value });
    refresh();
  }

  async function markDone() {
    if (!session) return;
    await api.patchSession(id, {
      user_status: session.user_status === 'done' ? 'active' : 'done',
    });
    refresh();
  }

  async function resume() {
    if (!session) return;
    await api.launch({ project_path: session.project_path, resume_id: session.id });
  }

  async function fork() {
    if (!session) return;
    try {
      const resp = await api.forkSession(session.id, { web_only: true });
      navigate(`/sessions/${resp.session_id}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    if (!session) return;
    const currentId = session.id;
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta && !e.altKey) return;
      if (editing) return;
      const key = e.key.toLowerCase();
      if (!e.shiftKey && !e.altKey && key === 'e') {
        e.preventDefault();
        setLaunchOpen(true);
        return;
      }
      if (!e.shiftKey && !e.altKey && key === '.') {
        if (isInputFocused()) return;
        e.preventDefault();
        markDone();
        return;
      }
      if (!e.shiftKey && !e.altKey && key === 'b') {
        if (isInputFocused()) return;
        e.preventDefault();
        setView(v => (v === 'conversation' ? 'diff' : 'conversation'));
        return;
      }
      if (e.shiftKey && !e.altKey && key === 'f') {
        if (isInputFocused()) return;
        e.preventDefault();
        fork();
        return;
      }
      const digitCode = e.code?.match(/^Digit([1-9])$/);
      if (!e.shiftKey && e.altKey && !meta && digitCode) {
        const slot = Number(digitCode[1]);
        const targetId = sessionBySlot.get(slot);
        if (!targetId) return;
        e.preventDefault();
        rememberSlotNav(currentId, targetId, slot);
        navigate(`/sessions/${targetId}`);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sessionBySlot, editing]);

  if (err) return <div className="error pad">{err}</div>;
  if (!data || !session) return <div className="muted pad">loading…</div>;
  const { events } = data;
  const ctxPct = session.usage ? contextPercent(session.usage) : null;

  return (
    <div className="detail">
      <div className="detail-header">
        <div className="title-row">
          <span className="state-pill">{STATE_LABELS[session.derived_state] ?? session.derived_state}</span>
          {editing ? (
            <input
              autoFocus
              className="title-input"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={async () => {
                await saveTitle(titleDraft.trim() || null);
                setEditing(false);
              }}
              onKeyDown={async e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  await saveTitle(titleDraft.trim() || null);
                  setEditing(false);
                } else if (e.key === 'Escape') {
                  setEditing(false);
                }
              }}
            />
          ) : (
            <h1
              className="title"
              onClick={() => {
                setTitleDraft(session.title ?? session.display_name);
                setEditing(true);
              }}
              title="click to rename"
            >
              {session.display_name}
            </h1>
          )}
        </div>
        <div className="meta-row muted small">
          <span className="mono">{session.project_path}</span>
          <span className="add-dir-wrapper">
            <button
              className="add-dir-btn"
              title="Add another directory to this session"
              onClick={() => { setAddDirOpen(v => !v); setAddDirValue(''); }}
            >
              {addDirOpen ? '×' : '+'}
            </button>
            {addDirOpen && (
              <div
                className="add-dir-popover"
                onKeyDown={e => { if (e.key === 'Escape') { setAddDirOpen(false); setAddDirValue(''); } }}
              >
                <RepoSelect
                  repos={repos.filter(r => r.project_path !== session.project_path)}
                  value={addDirValue}
                  onChange={setAddDirValue}
                  autoFocus
                  placeholder="pick or type a directory path"
                />
                <button
                  className="primary"
                  disabled={!addDirValue.trim()}
                  onClick={async () => {
                    const path = addDirValue.trim();
                    setAddDirOpen(false);
                    setAddDirValue('');
                    await api.addDir(session.id, path);
                  }}
                >
                  Add
                </button>
              </div>
            )}
          </span>
          {session.git_branch && (
            <>
              <span>•</span>
              <span>{session.git_branch}</span>
            </>
          )}
          <span>•</span>
          <span>last activity <span className="age-value">{ageStr(now, session.last_event_at)}</span> ago</span>
          {session.queued_message && (
            <>
              <span>•</span>
              <span className="queued-pill" title={session.queued_message}>📥 queued</span>
            </>
          )}
          {!!session.plan_mode && (
            <>
              <span>•</span>
              <span className="plan-mode-pill" title={session.plan_file_path ?? 'Plan mode'}>📝 planning</span>
            </>
          )}
          {!!session.auto_mode && (
            <>
              <span>•</span>
              <span className="auto-mode-pill" title="Auto mode is active for this session">🤖 auto</span>
            </>
          )}
          {session.usage && session.usage.totalTokens > 0 && (
            <>
              <span>•</span>
              <span className="usage-stat" title={usageTooltip(session.usage)}>
                {formatCost(session.usage.costUSD)}
                <span className="usage-tokens"> ({formatTokens(session.usage.totalTokens)} tok)</span>
              </span>
            </>
          )}
          {ctxPct != null && (
            <>
              <span>•</span>
              <span
                className={'context-pill' + (ctxPct >= 90 ? ' context-pill-critical' : ctxPct >= 70 ? ' context-pill-warning' : '')}
                title={usageTooltip(session.usage!)}
              >
                {ctxPct}% context
              </span>
            </>
          )}
          {session.tool_usage && Object.keys(session.tool_usage).length > 0 && (
            <>
              <span>•</span>
              {Object.entries(session.tool_usage)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .map(([name, count]) => (
                  <span key={name} className="usage-pill">{name}: {count}</span>
                ))}
            </>
          )}
        </div>
        {(session.linear_issue_identifier || session.pr_url) && (
          <div className="pr-row" style={{ display: 'flex', gap: '8px' }}>
            {session.linear_issue_identifier && session.linear_issue_url && (
              <a className="linear-issue-link linear-issue-link-large" href={session.linear_issue_url} target="_blank" rel="noreferrer">
                {session.linear_issue_identifier}
              </a>
            )}
            {session.pr_url && (
              <a className="pr-link pr-link-large" href={session.pr_url} target="_blank" rel="noreferrer">
                {session.pr_repository ?? 'PR'} #{session.pr_number}
              </a>
            )}
          </div>
        )}
      </div>

      {headerActionsSlot && createPortal(
        <>
          <button className="primary" onClick={() => setLaunchOpen(true)} title="New session">
            + New session <kbd className="kbd-hint">⌘E</kbd>
          </button>
          <button
            onClick={() => setView(v => (v === 'conversation' ? 'diff' : 'conversation'))}
            title="Toggle conversation / diff view"
          >
            {view === 'conversation' ? 'View changes' : 'View chat'}
            <kbd className="kbd-hint">⌘B</kbd>
          </button>
          <button onClick={markDone} title="Toggle done">
            {session.user_status === 'done' ? 'Mark active' : 'Mark done'}
            <kbd className="kbd-hint">⌘.</kbd>
          </button>
          <div className="action-more" ref={moreRef}>
            <button onClick={() => setMoreOpen(v => !v)} title="More actions">···</button>
            {moreOpen && (
              <div className="action-more-menu">
                <button onClick={() => { fork(); setMoreOpen(false); }}>Fork</button>
                <button onClick={() => { resume(); setMoreOpen(false); }}>Resume in Ghostty</button>
              </div>
            )}
          </div>
        </>,
        headerActionsSlot,
      )}

      <div className="detail-body">
        {view === 'conversation' ? (
          <Composer key={session.id} session={session} initialEvents={events} />
        ) : (
          <GitView sessionId={session.id} />
        )}
        <SessionSidebar
          currentSessionId={session.id}
          currentRepoName={session.repo_name}
          sessions={activeSessions}
          loaded={activeLoaded}
          slotBySessionId={slotBySessionId}
        />
      </div>

      {launchOpen && (
        <LaunchModal
          repos={repos}
          initialProjectPath={session.project_path}
          onClose={() => setLaunchOpen(false)}
          onLaunched={() => setLaunchOpen(false)}
        />
      )}
    </div>
  );
}
