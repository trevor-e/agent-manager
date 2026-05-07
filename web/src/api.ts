import type { Session, RepoSummary, SessionEvent } from './types';

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
  patchSession: (id: string, body: Partial<{ user_status: 'active' | 'done' | 'archived'; title: string | null; notes: string | null }>) =>
    jsend<{ session: Session }>(`/api/sessions/${id}`, 'PATCH', body),
  launch: (body: { project_path: string; resume_id?: string; title?: string; web_only?: boolean }) =>
    jsend<{ ok: boolean; session_id: string }>('/api/sessions/launch', 'POST', body),
  repos: () => jget<{ repos: RepoSummary[] }>('/api/repos'),
  scan: () => jsend<{ ok: boolean }>('/api/scan', 'POST'),

  sendMessage: (id: string, content: string) =>
    jsend<{ ok: boolean }>(`/api/sessions/${id}/messages`, 'POST', { content }),
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
  stopAgent: (id: string) => jsend<{ ok: boolean }>(`/api/sessions/${id}/stop`, 'POST'),
};
