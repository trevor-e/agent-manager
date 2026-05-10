import { useState } from 'react';
import type { RepoSummary, Session } from '../../types';
import { RepoSelect } from '../RepoSelect';

export function QuickActions({
  pending,
  session,
  repos,
  onSendPrompt,
  onEnterPlanMode,
  onAddDirectory,
}: {
  pending: boolean;
  session: Session;
  repos: RepoSummary[];
  onSendPrompt: (text: string) => void;
  onEnterPlanMode: () => void;
  onAddDirectory: (path: string) => void;
}) {
  const [addDirOpen, setAddDirOpen] = useState(false);
  const [addDirValue, setAddDirValue] = useState('');

  return (
    <>
      <div className="composer-quick-actions">
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => onSendPrompt('review the diff of your changes for any bugs, issues, or things I should know about')}
          title="Send: review the diff of your changes"
        >
          Review changes
        </button>
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => onSendPrompt('commit and push the changes')}
          title="Send: commit and push the changes"
        >
          Commit &amp; push
        </button>
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => onSendPrompt('create a draft pull request for these changes')}
          title="Send: create a draft pull request"
        >
          Create PR
        </button>
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => onSendPrompt("how's it going?")}
          title="Send: how's it going?"
        >
          Nudge
        </button>
        <button
          className="quick-action"
          onClick={onEnterPlanMode}
          title="Switch the live agent into plan mode (read-only research, then a plan you approve)"
        >
          Plan mode
        </button>
        <button
          className="quick-action"
          disabled={pending}
          onClick={() => onSendPrompt('Review the last ~20 messages in this conversation for recurring issues, corrections you received, or patterns worth codifying. Suggest specific additions or edits to CLAUDE.md — but do NOT apply them yet. Just list the proposed changes and wait for my approval.')}
          title="Suggest CLAUDE.md updates based on recent chat"
        >
          Update CLAUDE.md
        </button>
        <button
          className="quick-action"
          onClick={() => { setAddDirOpen(v => !v); setAddDirValue(''); }}
          title="Add another repo/directory to this session's context"
        >
          {addDirOpen ? 'Cancel' : 'Add directory'}
        </button>
      </div>

      {addDirOpen && (
        <div className="add-dir-inline">
          <RepoSelect
            repos={repos.filter(r => r.project_path !== session.project_path)}
            value={addDirValue}
            onChange={setAddDirValue}
            autoFocus
            placeholder="pick or type a directory path"
          />
          <button
            className="primary"
            disabled={!addDirValue.trim()}
            onClick={() => {
              onAddDirectory(addDirValue);
              setAddDirOpen(false);
              setAddDirValue('');
            }}
          >
            Add
          </button>
        </div>
      )}
    </>
  );
}
