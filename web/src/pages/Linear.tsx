import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { LaunchModal } from '../components/LaunchModal';
import type { LinearIssue, LinearProject, RepoSummary } from '../types';

const PRIORITY_LABELS: Record<number, string> = {
  0: '',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

const STATE_FILTERS = [
  { key: '', label: 'All' },
  { key: 'started', label: 'In Progress' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'completed', label: 'Done' },
];

export function LinearPage() {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [projects, setProjects] = useState<LinearProject[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('started');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [launchIssue, setLaunchIssue] = useState<LinearIssue | null>(null);

  async function refresh() {
    try {
      const params: { projectId?: string; stateType?: string } = {};
      if (projectFilter) params.projectId = projectFilter;
      if (stateFilter) params.stateType = stateFilter;
      const r = await api.linearIssues(params);
      setIssues(r.issues);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, stateFilter]);

  useEffect(() => {
    api.linearProjects().then(r => setProjects(r.projects)).catch(() => {});
    api.repos().then(r => setRepos(r.repos)).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return issues;
    const q = search.toLowerCase();
    return issues.filter(i =>
      i.identifier.toLowerCase().includes(q) ||
      i.title.toLowerCase().includes(q) ||
      (i.project?.name ?? '').toLowerCase().includes(q)
    );
  }, [issues, search]);

  return (
    <div className="list-page">
      <div className="toolbar">
        <div className="chips">
          {STATE_FILTERS.map(f => (
            <button
              key={f.key}
              className={'chip ' + (stateFilter === f.key ? 'chip-active' : '')}
              onClick={() => setStateFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          className="search"
          style={{ minWidth: 180 }}
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          className="search"
          placeholder="filter issues..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="grow" />
        <span className="muted">{filtered.length} issues</span>
      </div>

      {loading && <div className="muted pad">loading...</div>}
      {err && <div className="error pad">{err}</div>}

      <ul className="sessions sessions-flat">
        {filtered.map(issue => (
          <li key={issue.id} className="row linear-issue-row">
            <span className={'linear-state-badge linear-state-' + issue.state.type}>
              {issue.state.name}
            </span>
            <span className="linear-identifier">{issue.identifier}</span>
            <a
              className="row-name"
              href={issue.url}
              target="_blank"
              rel="noreferrer"
            >
              {issue.title}
            </a>
            {issue.priority > 0 && issue.priority <= 4 && (
              <span className={'linear-priority linear-priority-' + issue.priority}>
                {PRIORITY_LABELS[issue.priority]}
              </span>
            )}
            {issue.project && (
              <span className="repo-tag"
                onClick={() => setProjectFilter(issue.project!.id)}
                title={`filter to ${issue.project.name}`}
              >
                {issue.project.name}
              </span>
            )}
            {issue.labels.length > 0 && (
              <span className="muted small">{issue.labels.map(l => l.name).join(', ')}</span>
            )}
            <span className="grow" />
            <div className="row-actions">
              <button className="primary" onClick={() => setLaunchIssue(issue)}>
                Launch session
              </button>
            </div>
          </li>
        ))}
      </ul>

      {launchIssue && (
        <LaunchModal
          repos={repos}
          linearIssue={launchIssue}
          onClose={() => setLaunchIssue(null)}
          onLaunched={() => setLaunchIssue(null)}
        />
      )}
    </div>
  );
}
