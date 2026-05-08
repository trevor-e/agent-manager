import { useEffect, useState } from 'react';
import { api } from '../api';
import type { FileChange, GitChanges } from '../types';
import { RawUnifiedDiff } from './UnifiedDiff';

type Mode = 'working' | 'branch';

const STATUS_LABEL: Record<FileChange['status'], string> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type',
  U: 'unmerged',
  '??': 'untracked',
};

export function GitView({ sessionId }: { sessionId: string }) {
  const [mode, setMode] = useState<Mode>('working');
  const [data, setData] = useState<GitChanges | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh(m: Mode) {
    setLoading(true);
    try {
      const r = await api.getGit(sessionId, m);
      setData(r.changes);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, mode]);

  const totalAdd = data?.files.reduce((s, f) => s + f.additions, 0) ?? 0;
  const totalDel = data?.files.reduce((s, f) => s + f.deletions, 0) ?? 0;

  return (
    <div className="git-view">
      <div className="git-view-header">
        <div className="git-view-tabs">
          <button
            className={'tab ' + (mode === 'working' ? 'tab-on' : '')}
            onClick={() => setMode('working')}
          >
            Working tree
          </button>
          <button
            className={'tab ' + (mode === 'branch' ? 'tab-on' : '')}
            onClick={() => setMode('branch')}
          >
            Branch vs main
          </button>
        </div>
        <div className="grow" />
        <button className="ghost" onClick={() => refresh(mode)} disabled={loading}>
          {loading ? 'refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="git-view-meta muted small">
        {data?.branch && <span>on <span className="mono">{data.branch}</span></span>}
        {data?.mode === 'branch' && data?.baseRef && (
          <>
            <span>•</span>
            <span>vs <span className="mono">{data.baseRef}</span></span>
            {data.ahead > 0 && (
              <>
                <span>•</span>
                <span>{data.ahead} commit{data.ahead === 1 ? '' : 's'} ahead</span>
              </>
            )}
          </>
        )}
        {data && data.files.length > 0 && (
          <>
            <span>•</span>
            <span>
              {data.files.length} file{data.files.length === 1 ? '' : 's'}
              <span className="diff-add-count"> +{totalAdd}</span>
              <span className="diff-del-count"> −{totalDel}</span>
            </span>
          </>
        )}
        {data?.warning && (
          <>
            <span>•</span>
            <span className="warning-chip">{data.warning}</span>
          </>
        )}
      </div>

      {err && <div className="error pad">{err}</div>}
      {data && !data.isRepo && (
        <div className="muted pad">This project isn't a git repository.</div>
      )}
      {data?.isRepo && data.files.length === 0 && !err && (
        <div className="muted pad">No changes.</div>
      )}

      <div className="git-files">
        {data?.files.map((f) => (
          <FileBlock key={f.path} file={f} />
        ))}
      </div>
    </div>
  );
}

function FileBlock({ file }: { file: FileChange }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="git-file">
      <button
        className="git-file-header"
        onClick={() => setOpen((v) => !v)}
        title="toggle diff"
      >
        <span className={`git-status git-status-${file.status === '??' ? 'U' : file.status}`}>
          {STATUS_LABEL[file.status] ?? file.status}
        </span>
        <span className="git-file-path mono">{file.path}</span>
        <span className="grow" />
        {!file.binary && (file.additions > 0 || file.deletions > 0) && (
          <span className="git-file-stats">
            <span className="diff-add-count">+{file.additions}</span>
            <span className="diff-del-count">−{file.deletions}</span>
          </span>
        )}
        {file.binary && <span className="muted small">binary</span>}
        {file.truncated && <span className="muted small">truncated</span>}
        <span className="git-file-toggle">{open ? '▾' : '▸'}</span>
      </button>
      {open && !file.binary && file.diff && (
        <RawUnifiedDiff diff={file.diff} />
      )}
    </div>
  );
}
