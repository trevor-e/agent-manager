import { spawn } from 'node:child_process';
import { config } from '../config.ts';
import type { LaunchOptions } from '../shared/types.ts';
import { buildSessionArgs, appendLaunchOptionArgs } from './args.ts';

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
  const args = [
    'claude',
    ...buildSessionArgs({
      sessionId: opts.sessionId,
      isNew: opts.kind === 'new',
      forkFrom: opts.launchOptions?.forkFrom,
      title: opts.title,
    }),
  ];
  appendLaunchOptionArgs(args, opts.launchOptions);
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
