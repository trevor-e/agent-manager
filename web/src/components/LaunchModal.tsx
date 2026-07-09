import { useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../App';
import type { EffortLevel, LaunchOptions, LinearIssue, PermissionMode, RepoSummary, Workflow } from '../types';
import { RepoSelect } from './RepoSelect';

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'auto', label: 'Auto (classifier decides)' },
  { value: 'default', label: 'Default (ask each time)' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan mode (read-only)' },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
  { value: 'dontAsk', label: "Don't ask" },
];

const MODELS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-fable-5', label: 'Fable 5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
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
  const [projectPath, setProjectPath] = useState(
    initialProjectPath.replace(/\/\.claude\/worktrees\/[^/]+$/, '')
  );
  const [title, setTitle] = useState(linearIssue ? `${linearIssue.identifier}: ${linearIssue.title}` : '');
  const [openInTerminal, setOpenInTerminal] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto');
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const [worktreeName, setWorktreeName] = useState('');
  const [model, setModel] = useState('claude-sonnet-5');
  const [fallbackModel, setFallbackModel] = useState('');
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  const [addDirsText, setAddDirsText] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [appendSystemPrompt, setAppendSystemPrompt] = useState('');
  const [linearInput, setLinearInput] = useState('');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [workflowArgs, setWorkflowArgs] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getWorkflows().then(r => setWorkflows(r.workflows)).catch(() => setWorkflows([]));
  }, []);

  const selectedWorkflow = workflows.find(w => w.id === workflowId) ?? null;
  const workflowCards: { id: string; label: string; description: string | null }[] = [
    { id: '', label: 'Standard', description: 'Blank session, no preset instructions' },
    ...workflows,
  ];

  function buildLaunchOptions(): LaunchOptions {
    const opts: LaunchOptions = { permissionMode };
    if (workflowId) {
      opts.workflowId = workflowId;
      if (workflowArgs.trim()) opts.workflowArgs = workflowArgs.trim();
    }
    if (worktreeEnabled) {
      opts.worktree = { enabled: true };
      if (worktreeName.trim()) opts.worktree.name = worktreeName.trim();
    }
    if (model.trim()) opts.model = model.trim();
    if (fallbackModel && fallbackModel !== model) opts.fallbackModel = fallbackModel;
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
        <div className="modal-body">
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

        <label className="modal-section-label">Workflow</label>
        <div className="workflow-cards">
          {workflowCards.map(w => (
            <button
              key={w.id || 'standard'}
              type="button"
              className={`workflow-card${workflowId === w.id ? ' workflow-card-selected' : ''}`}
              onClick={() => {
                setWorkflowId(w.id);
                if (w.id === 'plan') setPermissionMode('plan');
              }}
            >
              <span className="workflow-card-title">{w.label}</span>
              {w.description && <span className="workflow-card-desc">{w.description}</span>}
            </button>
          ))}
        </div>
        {workflowId === 'plan' && permissionMode === 'plan' && (
          <p className="hint">
            Permission mode set to Plan mode (read-only) — you'll get a prompt to accept the plan and switch modes before claude starts editing.
          </p>
        )}
        {selectedWorkflow && (
          <>
            <label>Task for this workflow</label>
            <textarea
              value={workflowArgs}
              onChange={e => setWorkflowArgs(e.target.value)}
              placeholder="Describe what to investigate / plan / build / review"
              autoFocus
            />
          </>
        )}

        <div className="row">
          <div>
            <label>Model</label>
            <select value={model} onChange={e => setModel(e.target.value)}>
              {MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Effort</label>
            <select value={effort} onChange={e => setEffort(e.target.value as EffortLevel | '')}>
              {EFFORTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Permission mode</label>
            <select value={permissionMode} onChange={e => setPermissionMode(e.target.value as PermissionMode)}>
              {PERMISSION_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

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

        <details className="modal-more">
          <summary>More options</summary>
          <div className="modal-more-body">
            <div className="modal-field">
              <label>Fallback model (when primary is overloaded)</label>
              <select value={fallbackModel} onChange={e => setFallbackModel(e.target.value)}>
                <option value="">None</option>
                {MODELS.filter(m => m.value !== model).map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="modal-field">
              <label>System prompt (replaces default)</label>
              <textarea
                className="compact"
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="Custom system prompt — replaces the default entirely"
              />
            </div>
            <div className="modal-field">
              <label>Append to system prompt</label>
              <textarea
                className="compact"
                value={appendSystemPrompt}
                onChange={e => setAppendSystemPrompt(e.target.value)}
                placeholder="Added after the default system prompt"
              />
            </div>
            <div className="modal-field">
              <label>Additional allowed directories</label>
              <textarea
                className="compact"
                value={addDirsText}
                onChange={e => setAddDirsText(e.target.value)}
                placeholder="One path per line, or comma-separated"
              />
            </div>
          </div>
        </details>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={openInTerminal}
            onChange={e => setOpenInTerminal(e.target.checked)}
          />
          <span>Open in Ghostty terminal instead of web chat</span>
        </label>
        </div>
        <div className="modal-footer">
          {err && <div className="error">{err}</div>}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={pending}>
              {pending ? 'Launching…' : openInTerminal ? 'Launch in Ghostty' : 'Launch web chat'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
