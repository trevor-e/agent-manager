export function QuickActions({
  pending,
  onSendPrompt,
  onEnterPlanMode,
}: {
  pending: boolean;
  onSendPrompt: (text: string) => void;
  onEnterPlanMode: () => void;
}) {
  return (
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
        onClick={() => onSendPrompt("commit and push only the changes made in this session — the working tree may have unrelated changes from other parallel sessions, so check the diff carefully and don't include anything you didn't touch in this conversation")}
        title="Send: commit and push only the changes from this session"
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
        onClick={() => onSendPrompt("Check the PR review comments for any recent bot feedback (Cursor, Sentry, codecov, etc.). Summarize what the bots flagged, then give your honest assessment of each point — which ones are worth addressing and which are noise. Don't blindly follow bot suggestions; think critically about whether each suggestion actually improves the code.")}
        title="Review bot feedback on the PR"
      >
        Review bot feedback
      </button>
      <button
        className="quick-action"
        disabled={pending}
        onClick={() => onSendPrompt("Check the GitHub Actions status for the current PR. If any checks failed, investigate the failure logs and suggest fixes.")}
        title="Check GitHub Actions status for the PR"
      >
        Check CI status
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
    </div>
  );
}
