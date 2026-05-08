import { spawn } from 'node:child_process';
import { config } from '../config.ts';
import type { LaunchOptions } from '../db.ts';

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

type LaunchKind = 'new' | 'resume';

export type LaunchOpts = {
  cwd: string;
  kind: LaunchKind;
  sessionId: string;
  title?: string | null;
  launchOptions?: LaunchOptions | null;
};

export type LaunchResult = {
  command: string;
};

function buildClaudeArgv(opts: LaunchOpts): string[] {
  const args = ['claude'];
  if (opts.kind === 'new') {
    args.push('--session-id', opts.sessionId);
    if (opts.title) args.push('--name', opts.title);
  } else {
    args.push('-r', opts.sessionId);
  }
  const lo = opts.launchOptions;
  if (lo) {
    if (lo.permissionMode) args.push('--permission-mode', lo.permissionMode);
    if (lo.model) args.push('--model', lo.model);
    if (lo.effort) args.push('--effort', lo.effort);
    if (lo.addDirs && lo.addDirs.length > 0) args.push('--add-dir', ...lo.addDirs);
    if (lo.worktree?.enabled) {
      args.push('--worktree');
      if (lo.worktree.name) args.push(lo.worktree.name);
    }
  }
  return args;
}

export function launchSession(opts: LaunchOpts): LaunchResult {
  if (config.launcher !== 'ghostty') {
    throw new Error(`Unknown launcher: ${config.launcher}`);
  }

  const claudeArgv = buildClaudeArgv(opts);
  const commandStr = claudeArgv.map(shellEscape).join(' ');
  const args = [
    '-na',
    'Ghostty.app',
    '--args',
    `--working-directory=${opts.cwd}`,
    `--command=${commandStr}`,
  ];
  spawn('/usr/bin/open', args, { detached: true, stdio: 'ignore' }).unref();
  return { command: `open ${args.join(' ')}` };
}
