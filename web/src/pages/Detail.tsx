import { useEffect, useState } from 'react';
import { api } from '../api';
import { Composer } from '../components/Composer';
import { LaunchModal } from '../components/LaunchModal';
import { SessionSidebar } from '../components/SessionSidebar';
import type { RepoSummary, Session, SessionEvent } from '../types';
import { useNow } from '../useNow';

const STATE_LABELS: Record<string, string> = {
  launching: '🚀 launching',
  working: '🟢 working',
  waiting: '🟡 waiting on you',
  blocked: '🔴 needs approval',
  idle: '⚪ idle',
  stale: '🌫 stale',
  done: '✅ done',
  archived: '📦 archived',
};

function ageStr(now: number, ms: number): string {
  const d = now - ms;
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}

export function DetailPage({ id }: { id: string }) {
  const [data, setData] = useState<{ session: Session; events: SessionEvent[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const now = useNow();

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

  if (err) return <div className="error pad">{err}</div>;
  if (!data) return <div className="muted pad">loading…</div>;
  const { session, events } = data;

  async function saveTitle(value: string | null) {
    await api.patchSession(id, { title: value });
    refresh();
  }

  async function markDone() {
    await api.patchSession(id, {
      user_status: session.user_status === 'done' ? 'active' : 'done',
    });
    refresh();
  }

  async function resume() {
    await api.launch({ project_path: session.project_path, resume_id: session.id });
  }

  return (
    <div className="detail">
      <div className="detail-header">
        <div>
          <div className="state-pill">{STATE_LABELS[session.derived_state] ?? session.derived_state}</div>
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
          <div className="meta-row muted small">
            <span className="mono">{session.id}</span>
            <span>•</span>
            <span className="mono">{session.project_path}</span>
            {session.git_branch && (
              <>
                <span>•</span>
                <span>{session.git_branch}</span>
              </>
            )}
            <span>•</span>
            <span>last activity {ageStr(now, session.last_event_at)} ago</span>
          </div>
          {session.pr_url && (
            <div className="pr-row">
              <a className="pr-link pr-link-large" href={session.pr_url} target="_blank" rel="noreferrer">
                {session.pr_repository ?? 'PR'} #{session.pr_number}
              </a>
            </div>
          )}
        </div>
        <div className="grow" />
        <div className="actions">
          <button className="primary" onClick={() => setLaunchOpen(true)} title={`New session in ${session.project_path}`}>
            + New session
          </button>
          <button onClick={resume}>Resume in Ghostty</button>
          <button className="ghost" onClick={markDone}>
            {session.user_status === 'done' ? 'Mark active' : 'Mark done'}
          </button>
        </div>
      </div>

      <div className="detail-body">
        <Composer key={session.id} session={session} initialEvents={events} />
        <SessionSidebar currentSessionId={session.id} currentRepoName={session.repo_name} />
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

