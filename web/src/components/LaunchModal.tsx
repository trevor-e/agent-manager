import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../App';
import type { RepoSummary } from '../types';

export function LaunchModal({
  repos,
  initialProjectPath = '',
  onClose,
  onLaunched,
}: {
  repos: RepoSummary[];
  initialProjectPath?: string;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [projectPath, setProjectPath] = useState(initialProjectPath);
  const [title, setTitle] = useState('');
  const [openInTerminal, setOpenInTerminal] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectPath.trim()) {
      setErr('Pick or type a project path');
      return;
    }
    setPending(true);
    try {
      const resp = await api.launch({
        project_path: projectPath.trim(),
        title: title.trim() || undefined,
        web_only: !openInTerminal,
      });
      onLaunched();
      if (!openInTerminal) navigate(`/sessions/${resp.session_id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h3>Launch new session</h3>
        <label>Project directory</label>
        <input
          autoFocus
          list="repo-paths"
          value={projectPath}
          onChange={e => setProjectPath(e.target.value)}
          placeholder="/Users/.../some-repo"
        />
        <datalist id="repo-paths">
          {repos.map(r => (
            <option key={r.project_path} value={r.project_path}>{r.repo_name}</option>
          ))}
        </datalist>
        <label>Title (optional)</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. fix flaky test"
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={openInTerminal}
            onChange={e => setOpenInTerminal(e.target.checked)}
          />
          <span>Open in Ghostty terminal instead of web chat</span>
        </label>
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Launching…' : openInTerminal ? 'Launch in Ghostty' : 'Launch web chat'}
          </button>
        </div>
      </form>
    </div>
  );
}
