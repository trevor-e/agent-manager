import type { Session, RepoSummary, SessionEvent, GitChanges, LaunchOptions, LinearIssue, LinearProject } from './types';

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

async function jsend<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${url} -> ${r.status} ${text}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  listSessions: (params: { status?: string; repo?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.repo) qs.set('repo', params.repo);
    if (params.q) qs.set('q', params.q);
    return jget<{ sessions: Session[] }>(`/api/sessions?${qs.toString()}`);
  },
  getSession: (id: string) => jget<{ session: Session; events: SessionEvent[] }>(`/api/sessions/${id}`),
  patchSession: (id: string, body: Partial<{ user_status: 'active' | 'done' | 'archived'; title: string | null }>) =>
    jsend<{ session: Session }>(`/api/sessions/${id}`, 'PATCH', body),
  launch: (body: {
    project_path: string;
    resume_id?: string;
    title?: string;
    web_only?: boolean;
    launch_options?: LaunchOptions;
  }) => jsend<{ ok: boolean; session_id: string }>('/api/sessions/launch', 'POST', body),
  repos: () => jget<{ repos: RepoSummary[] }>('/api/repos'),
  scan: () => jsend<{ ok: boolean }>('/api/scan', 'POST'),

  sendMessage: (
    id: string,
    content: string,
    images?: Array<{ mediaType: string; data: string }>
  ) =>
    jsend<{ ok: boolean }>(`/api/sessions/${id}/messages`, 'POST', {
      content,
      ...(images && images.length ? { images } : {}),
    }),
  resolveApproval: (
    id: string,
    approvalId: string,
    decision: 'approve' | 'deny',
    opts: { reason?: string; updatedInput?: unknown } = {}
  ) =>
    jsend<{ ok: boolean }>(`/api/sessions/${id}/approvals/${approvalId}`, 'POST', {
      decision,
      reason: opts.reason,
      updatedInput: opts.updatedInput,
    }),
  interrupt: (id: string) => jsend<{ ok: boolean }>(`/api/sessions/${id}/interrupt`, 'POST'),
  setPermissionMode: (id: string, mode: import('./types').PermissionMode) =>
    jsend<{ ok: boolean }>(`/api/sessions/${id}/permission-mode`, 'POST', { mode }),
  stopAgent: (id: string) => jsend<{ ok: boolean }>(`/api/sessions/${id}/stop`, 'POST'),
  addDir: (id: string, path: string) =>
    jsend<{ ok: boolean; restarted: boolean }>(`/api/sessions/${id}/add-dir`, 'POST', { path }),
  forkSession: (id: string, opts?: { web_only?: boolean }) =>
    jsend<{ ok: boolean; session_id: string }>(`/api/sessions/${id}/fork`, 'POST', opts),

  getGit: (id: string, mode: 'working' | 'branch') =>
    jget<{ changes: GitChanges }>(`/api/sessions/${id}/git?mode=${mode}`),

  linearStatus: () => jget<{ configured: boolean }>('/api/linear/status'),
  linearIssues: (params: { projectId?: string; stateType?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.stateType) qs.set('stateType', params.stateType);
    return jget<{ issues: LinearIssue[] }>(`/api/linear/issues?${qs.toString()}`);
  },
  linearProjects: () => jget<{ projects: LinearProject[] }>('/api/linear/projects'),

  getKeys: () => jget<{ keys: Record<string, { set: boolean; source: string | null; masked: string | null }> }>('/api/keys'),
  setKeys: (keys: Record<string, string | null>) => jsend<{ ok: boolean }>('/api/keys', 'PUT', keys),
};
