import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../App';
import type { EffortLevel, LaunchOptions, LinearIssue, PermissionMode, RepoSummary } from '../types';
import { RepoSelect } from './RepoSelect';

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'auto', label: 'Auto (classifier decides)' },
  { value: 'default', label: 'Default (ask each time)' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan mode (read-only)' },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
  { value: 'dontAsk', label: "Don't ask" },
];

const EFFORTS: { value: EffortLevel | ''; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
];

export function LaunchModal({
  repos,
  initialProjectPath = '',
  linearIssue,
  onClose,
  onLaunched,
}: {
  repos: RepoSummary[];
  initialProjectPath?: string;
  linearIssue?: LinearIssue;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [projectPath, setProjectPath] = useState(initialProjectPath);
  const [title, setTitle] = useState(linearIssue ? `${linearIssue.identifier}: ${linearIssue.title}` : '');
  const [openInTerminal, setOpenInTerminal] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto');
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const [worktreeName, setWorktreeName] = useState('');
  const [model, setModel] = useState('claude-opus-4-6');
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  const [addDirsText, setAddDirsText] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [appendSystemPrompt, setAppendSystemPrompt] = useState('');
  const [linearInput, setLinearInput] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function buildLaunchOptions(): LaunchOptions {
    const opts: LaunchOptions = { permissionMode };
    if (worktreeEnabled) {
      opts.worktree = { enabled: true };
      if (worktreeName.trim()) opts.worktree.name = worktreeName.trim();
    }
    if (model.trim()) opts.model = model.trim();
    if (effort) opts.effort = effort;
    const dirs = addDirsText
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(Boolean);
    if (dirs.length) opts.addDirs = dirs;
    if (systemPrompt.trim()) opts.systemPrompt = systemPrompt.trim();
    if (appendSystemPrompt.trim()) opts.appendSystemPrompt = appendSystemPrompt.trim();
    if (linearIssue) opts.linearIssueId = linearIssue.id;
    else if (linearInput.trim()) opts.linearIssueId = linearInput.trim();
    return opts;
  }

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
        launch_options: buildLaunchOptions(),
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
        {linearIssue && (
          <a className="linear-issue-link" href={linearIssue.url} target="_blank" rel="noreferrer">
            {linearIssue.identifier}: {linearIssue.title}
          </a>
        )}
        <label>Project directory</label>
        <RepoSelect
          repos={repos}
          value={projectPath}
          onChange={setProjectPath}
          autoFocus
        />
        <label>Title (optional)</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. fix flaky test"
        />

        {!linearIssue && (
          <>
            <label>Linear issue (optional)</label>
            <input
              value={linearInput}
              onChange={e => setLinearInput(e.target.value)}
              placeholder="e.g. ENG-123"
            />
          </>
        )}

        <label>Permission mode</label>
        <select value={permissionMode} onChange={e => setPermissionMode(e.target.value as PermissionMode)}>
          {PERMISSION_MODES.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={worktreeEnabled}
            onChange={e => setWorktreeEnabled(e.target.checked)}
          />
          <span>Create a git worktree for this session</span>
        </label>
        {worktreeEnabled && (
          <input
            value={worktreeName}
            onChange={e => setWorktreeName(e.target.value)}
            placeholder="worktree name (optional)"
          />
        )}

        <details>
          <summary>More options</summary>
          <div className="row">
            <div>
              <label>Model</label>
              <input
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="sonnet, opus, haiku, or full id"
              />
            </div>
            <div>
              <label>Effort</label>
              <select value={effort} onChange={e => setEffort(e.target.value as EffortLevel | '')}>
                {EFFORTS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <label>System prompt (replaces default)</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="Custom system prompt — replaces the default entirely"
          />
          <label>Append to system prompt</label>
          <textarea
            value={appendSystemPrompt}
            onChange={e => setAppendSystemPrompt(e.target.value)}
            placeholder="Added after the default system prompt"
          />
          <label>Additional allowed directories</label>
          <textarea
            value={addDirsText}
            onChange={e => setAddDirsText(e.target.value)}
            placeholder="One path per line, or comma-separated"
          />
        </details>

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
