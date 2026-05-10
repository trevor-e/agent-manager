import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { navigate } from '../App';
import { LaunchModal } from '../components/LaunchModal';
import type { Session, RepoSummary } from '../types';
import { useNow } from '../useNow';
import { formatCost, usageTooltip } from '../format';
import { STATE_BADGES, ageStr } from '../constants';

const FILTER_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'done', label: 'Done' },
];

export function ListPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [repoFilter, setRepoFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const now = useNow();

  async function refresh() {
    try {
      const params: Record<string, string> = { status: filter };
      const [sessionsResp, reposResp] = await Promise.all([
        api.listSessions(params),
        api.repos(),
      ]);
      setSessions(sessionsResp.sessions);
      setRepos(reposResp.repos);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setLaunchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    let list = sessions;
    if (repoFilter) list = list.filter(s => s.repo_name === repoFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.display_name.toLowerCase().includes(q) ||
        s.repo_name.toLowerCase().includes(q) ||
        (s.last_prompt ?? '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const aDone = a.user_status === 'active' ? 0 : 1;
      const bDone = b.user_status === 'active' ? 0 : 1;
      if (aDone !== bDone) return aDone - bDone;
      return b.last_event_at - a.last_event_at;
    });
  }, [sessions, filter, search, repoFilter]);

  async function markDone(s: Session) {
    await api.patchSession(s.id, { user_status: s.user_status === 'done' ? 'active' : 'done' });
    refresh();
  }

  async function resume(s: Session) {
    await api.launch({ project_path: s.project_path, resume_id: s.id });
  }

  return (
    <div className="list-page">
      <div className="toolbar">
        <div className="chips">
          {FILTER_CHIPS.map(c => (
            <button
              key={c.key}
              className={'chip ' + (filter === c.key ? 'chip-active' : '')}
              onClick={() => setFilter(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          placeholder="search title or prompt…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {repoFilter && (
          <button className="chip chip-active" onClick={() => setRepoFilter(null)} title="clear repo filter">
            repo: {repoFilter} ✕
          </button>
        )}
        <div className="grow" />
        <span className="muted">{filtered.length} sessions</span>
        <button className="primary" onClick={() => setLaunchOpen(true)} title="New session">
          + New session <kbd className="kbd-hint">⌘E</kbd>
        </button>
      </div>

      {loading && <div className="muted pad">loading…</div>}
      {err && <div className="error pad">{err}</div>}

      <ul className="sessions sessions-flat">
        {filtered.map(s => {
          const badge = STATE_BADGES[s.derived_state] ?? STATE_BADGES.idle;
          const isDone = s.user_status === 'done';
          return (
            <li key={s.id} className="row">
              <span className={badge.cls + ' state-badge'}>{badge.label}</span>
              <button
                className="repo-tag"
                onClick={() => setRepoFilter(s.repo_name)}
                title={`filter to ${s.repo_name} (${s.project_path})`}
              >
                {s.repo_name}
              </button>
              <a
                className="row-name"
                href={`/sessions/${s.id}`}
                onClick={e => {
                  e.preventDefault();
                  navigate(`/sessions/${s.id}`);
                }}
              >
                {s.display_name}
              </a>
              {s.linear_issue_identifier && s.linear_issue_url && (
                <a
                  className="linear-issue-link"
                  href={s.linear_issue_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                >
                  {s.linear_issue_identifier}
                </a>
              )}
              {s.pr_url && (
                <a
                  className="pr-link"
                  href={s.pr_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  title={s.pr_repository ? `${s.pr_repository}#${s.pr_number}` : s.pr_url}
                >
                  PR #{s.pr_number}
                </a>
              )}
              {s.git_branch && <span className="muted small">{s.git_branch}</span>}
              {s.usage && s.usage.totalTokens > 0 && (
                <span className="usage-pill" title={usageTooltip(s.usage)}>
                  {formatCost(s.usage.costUSD)}
                </span>
              )}
              <span className="grow" />
              <div className="row-actions">
                <button className="primary" onClick={() => resume(s)} title="Resume in Ghostty">
                  Resume
                </button>
                <button className="ghost" onClick={() => markDone(s)} title={isDone ? 'Reopen this session' : 'Hide from active list'}>
                  {isDone ? 'Reopen' : 'Mark done'}
                </button>
              </div>
              <span className="muted small row-age">{ageStr(now, s.last_event_at)} ago</span>
            </li>
          );
        })}
      </ul>

      {launchOpen && (
        <LaunchModal
          repos={repos}
          onClose={() => setLaunchOpen(false)}
          onLaunched={() => {
            setLaunchOpen(false);
            setTimeout(refresh, 400);
          }}
        />
      )}
    </div>
  );
}
