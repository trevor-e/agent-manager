import { spawn } from 'node:child_process';
import { config } from '../config.ts';

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

type LaunchKind = 'new' | 'resume';

export type LaunchOpts = {
  cwd: string;
  kind: LaunchKind;
  sessionId: string;
  title?: string | null;
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
