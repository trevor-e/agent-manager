import type { LaunchOptions } from '../shared/types.ts';

export function buildSessionArgs(opts: {
  sessionId: string;
  isNew: boolean;
  forkFrom?: string;
  title?: string | null;
}): string[] {
  const args: string[] = [];
  if (opts.forkFrom) {
    args.push('--fork-session', '--resume', opts.forkFrom, '--session-id', opts.sessionId);
    if (opts.title) args.push('--name', opts.title);
  } else if (opts.isNew) {
    args.push('--session-id', opts.sessionId);
    if (opts.title) args.push('--name', opts.title);
  } else {
    args.push('--resume', opts.sessionId);
  }
  return args;
}

export function appendLaunchOptionArgs(args: string[], opts: LaunchOptions | null | undefined): void {
  if (!opts) return;
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
  if (opts.model) args.push('--model', opts.model);
  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.addDirs?.length) args.push('--add-dir', ...opts.addDirs);
  if (opts.worktree?.enabled) {
    args.push('--worktree');
    if (opts.worktree.name) args.push(opts.worktree.name);
  }
  if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt);
  if (opts.appendSystemPrompt) args.push('--append-system-prompt', opts.appendSystemPrompt);
}
