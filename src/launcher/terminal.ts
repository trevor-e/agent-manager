import { spawn } from 'node:child_process';
import { config } from '../config.ts';
import { getWorkflow } from '../db.ts';
import type { LaunchOptions } from '../shared/types.ts';
import { renderWorkflow } from '../workflows/render.ts';
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
  // For a new session launched with a workflow, seed the first turn by passing
  // the rendered workflow body as the initial prompt (positional argument).
  if (opts.kind === 'new' && opts.launchOptions?.workflowId) {
    const workflow = getWorkflow(opts.launchOptions.workflowId);
    if (workflow) {
      args.push(renderWorkflow(workflow.body, opts.launchOptions.workflowArgs));
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
