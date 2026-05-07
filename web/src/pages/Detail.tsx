import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Session, SessionEvent } from '../types';

const STATE_LABELS: Record<string, string> = {
  launching: '🚀 launching',
  working: '🟢 working',
  waiting: '🟡 waiting on you',
  idle: '⚪ idle',
  stale: '🌫 stale',
  done: '✅ done',
  archived: '📦 archived',
};

function ageStr(ms: number): string {
  const d = Date.now() - ms;
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
  const [notesDraft, setNotesDraft] = useState('');
  const notesSavedRef = useRef('');

  async function refresh() {
    try {
      const r = await api.getSession(id);
      setData(r);
      if (notesSavedRef.current === '') {
        notesSavedRef.current = r.session.notes ?? '';
        setNotesDraft(r.session.notes ?? '');
      }
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

  if (err) return <div className="error pad">{err}</div>;
  if (!data) return <div className="muted pad">loading…</div>;
  const { session, events } = data;

  async function save(field: 'title' | 'notes', value: string | null) {
    await api.patchSession(id, { [field]: value });
    if (field === 'notes') notesSavedRef.current = value ?? '';
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
                await save('title', titleDraft.trim() || null);
                setEditing(false);
              }}
              onKeyDown={async e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  await save('title', titleDraft.trim() || null);
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
            <span>last activity {ageStr(session.last_event_at)} ago</span>
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
          <button onClick={resume}>Resume in Ghostty</button>
          <button className="ghost" onClick={markDone}>
            {session.user_status === 'done' ? 'Mark active' : 'Mark done'}
          </button>
        </div>
      </div>

      <div className="detail-body">
        <section className="events">
          <h3 className="muted small">Last {events.length} events (newest first)</h3>
          <ol className="event-log">
            {[...events].reverse().map((ev, i) => (
              <EventRow key={i} ev={ev} />
            ))}
          </ol>
        </section>
        <aside className="side">
          <h3 className="muted small">Notes</h3>
          <textarea
            value={notesDraft}
            onChange={e => setNotesDraft(e.target.value)}
            onBlur={() => {
              if (notesDraft !== notesSavedRef.current) save('notes', notesDraft || null);
            }}
            placeholder="things to remember about this session…"
            rows={10}
          />
        </aside>
      </div>
    </div>
  );
}

function EventRow({ ev }: { ev: SessionEvent }) {
  const t = ev.type ?? 'unknown';
  const ts = typeof ev.timestamp === 'string' ? ev.timestamp : null;
  let body = '';
  if (t === 'last-prompt' && typeof ev.lastPrompt === 'string') body = ev.lastPrompt;
  else if (t === 'user' || t === 'assistant' || t === 'message') {
    const msg = (ev as any).message;
    if (msg && typeof msg === 'object') {
      const content = msg.content;
      if (typeof content === 'string') body = content;
      else if (Array.isArray(content)) {
        body = content
          .map((c: any) => {
            if (!c) return '';
            if (c.type === 'text') return c.text ?? '';
            if (c.type === 'tool_use') return `[tool: ${c.name}]`;
            if (c.type === 'tool_result')
              return `[tool result] ${typeof c.content === 'string' ? c.content : ''}`;
            if (c.type === 'thinking') return c.thinking ? `(thinking)` : '';
            return '';
          })
          .filter(Boolean)
          .join(' ');
      }
    }
  }
  body = body.replace(/\s+/g, ' ').trim();
  if (body.length > 600) body = body.slice(0, 600) + '…';
  return (
    <li className={`event event-${t}`}>
      <header className="event-header">
        <span className="event-type">{t}</span>
        {ts && <span className="muted small">{new Date(ts).toLocaleTimeString()}</span>}
        {body && <span className="event-body-inline">{body}</span>}
      </header>
    </li>
  );
}
