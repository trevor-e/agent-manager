import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { config } from '../config.ts';
import { db, getSession, type LaunchOptions } from '../db.ts';
import { log } from '../log.ts';
import type {
  ControlRequestEnvelope,
  ControlResponseEnvelope,
  IncomingMessage,
  OutgoingUserMessage,
  PermissionMode,
  PermissionResult,
  UserContentBlock,
} from './types.ts';

function parseLaunchOptions(raw: string | null | undefined): LaunchOptions | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LaunchOptions;
  } catch {
    return null;
  }
}

const TOOL_APPROVAL_CALLBACK = 'tool_approval';
const AUTO_APPROVE_CALLBACK = 'auto_approve';

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

const READ_ONLY_TOOLS = ['Glob', 'Grep', 'NotebookRead', 'Read', 'Task', 'TodoWrite'];

type PendingApproval = {
  approvalId: string;
  toolName: string;
  toolUseId: string | undefined;
  input: unknown;
  resolve: (result: PermissionResult) => void;
  reject: (err: Error) => void;
  createdAt: number;
};

export type AgentStatus = 'working' | 'awaiting_input' | 'awaiting_approval';

export type AgentEvent =
  | { type: 'output'; line: string; parsed: IncomingMessage | null }
  | { type: 'approval_request'; approvalId: string; toolName: string; input: unknown }
  | { type: 'approval_resolved'; approvalId: string; decision: 'approve' | 'deny'; reason?: string }
  | { type: 'stderr'; line: string }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null };

export class AgentProcess extends EventEmitter {
  readonly sessionId: string;
  readonly cwd: string;
  private child: ChildProcess | null = null;
  private stdinBuffer = '';
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private pendingApprovals = new Map<string, PendingApproval>();
  private exited = false;
  private turnStatus: 'working' | 'awaiting_input' = 'awaiting_input';

  constructor(opts: { sessionId: string; cwd: string }) {
    super();
    this.sessionId = opts.sessionId;
    this.cwd = opts.cwd;
  }

  start() {
    if (this.child) return;

    // If the session has never been written to disk (placeholder row), use
    // --session-id to create a fresh session with that UUID. Otherwise --resume.
    const existing = db
      .prepare('SELECT jsonl_path, launch_options FROM sessions WHERE id = ?')
      .get(this.sessionId) as
      | { jsonl_path: string | null; launch_options: string | null }
      | undefined;
    const isNew = !existing?.jsonl_path;
    const launchOptions = parseLaunchOptions(existing?.launch_options);

    const forkFrom = launchOptions?.forkFrom;
    const args = [
      '-p',
      ...(forkFrom
        ? ['--fork-session', '--resume', forkFrom, '--session-id', this.sessionId]
        : [isNew ? '--session-id' : '--resume', this.sessionId]),
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--replay-user-messages',
      '--verbose',
      '--permission-prompt-tool',
      'stdio',
      '--permission-mode',
      launchOptions?.permissionMode ?? 'bypassPermissions',
    ];
    if (launchOptions?.model) args.push('--model', launchOptions.model);
    if (launchOptions?.effort) args.push('--effort', launchOptions.effort);
    if (launchOptions?.addDirs?.length) args.push('--add-dir', ...launchOptions.addDirs);
    if (launchOptions?.worktree?.enabled) {
      args.push('--worktree');
      if (launchOptions.worktree.name) args.push(launchOptions.worktree.name);
    }
    if (launchOptions?.systemPrompt) args.push('--system-prompt', launchOptions.systemPrompt);
    if (launchOptions?.appendSystemPrompt) args.push('--append-system-prompt', launchOptions.appendSystemPrompt);

    this.child = spawn(config.claudeBin, args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NPM_CONFIG_LOGLEVEL: 'error', CLAUDE_MANAGER_AGENT: '1' },
    });

    this.child.stdout!.setEncoding('utf8');
    this.child.stderr!.setEncoding('utf8');
    this.child.stdout!.on('data', chunk => this.onStdoutChunk(String(chunk)));
    this.child.stderr!.on('data', chunk => this.onStderrChunk(String(chunk)));
    this.child.on('exit', (code, signal) => this.onExit(code, signal));
    this.child.on('error', err => {
      log('error', `agent:${this.sessionId}`, 'child error', { message: err.message, stack: err.stack });
      this.emit('error', err);
    });
    log('info', `agent:${this.sessionId}`, 'spawned', { pid: this.child.pid, cwd: this.cwd, isNew });

    void this.sendInitialize();
  }

  private async sendInitialize() {
    const hooks = {
      PreToolUse: [
        {
          matcher: `^(?!(${READ_ONLY_TOOLS.join('|')})$).*`,
          hookCallbackIds: [TOOL_APPROVAL_CALLBACK],
        },
        {
          matcher: `^(${READ_ONLY_TOOLS.join('|')})$`,
          hookCallbackIds: [AUTO_APPROVE_CALLBACK],
        },
      ],
    };
    await this.sendControl({ subtype: 'initialize', hooks });
  }

  // -------- outgoing -------- //

  async sendUserMessage(content: string | UserContentBlock[]) {
    if (!this.child) throw new Error('agent not started');
    if (this.exited) throw new Error('agent has exited');
    const msg: OutgoingUserMessage = {
      type: 'user',
      message: { role: 'user', content },
    };
    this.writeLine(JSON.stringify(msg));
    this.turnStatus = 'working';
  }

  get status(): AgentStatus {
    if (this.pendingApprovals.size > 0) return 'awaiting_approval';
    return this.turnStatus;
  }

  async setPermissionMode(mode: PermissionMode) {
    await this.sendControl({ subtype: 'set_permission_mode', mode });
  }

  async interrupt() {
    await this.sendControl({ subtype: 'interrupt' });
  }

  private async sendControl(request: ControlRequestEnvelope['request']) {
    const env: ControlRequestEnvelope = {
      type: 'control_request',
      request_id: randomUUID(),
      request,
    };
    this.writeLine(JSON.stringify(env));
  }

  private sendControlResponse(envelope: ControlResponseEnvelope) {
    this.writeLine(JSON.stringify(envelope));
  }

  private writeLine(line: string) {
    if (!this.child || !this.child.stdin || !this.child.stdin.writable) return;
    this.child.stdin.write(line + '\n');
  }

  // -------- approval queue -------- //

  resolveApproval(
    approvalId: string,
    decision: 'approve' | 'deny',
    opts: { reason?: string; updatedInput?: unknown } = {}
  ) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    this.pendingApprovals.delete(approvalId);
    if (decision === 'approve') {
      pending.resolve({
        behavior: 'allow',
        updatedInput: opts.updatedInput ?? pending.input,
      });
    } else {
      pending.resolve({
        behavior: 'deny',
        message:
          "The user doesn't want to proceed with this tool use. " +
          (opts.reason ? `Reason: ${opts.reason}` : ''),
        interrupt: false,
      });
    }
    this.emit('event', {
      type: 'approval_resolved',
      approvalId,
      decision,
      reason: opts.reason,
    } as AgentEvent);
    return true;
  }

  listPendingApprovals() {
    return [...this.pendingApprovals.values()].map(a => ({
      approvalId: a.approvalId,
      toolName: a.toolName,
      input: a.input,
      createdAt: a.createdAt,
    }));
  }

  // -------- incoming parse -------- //

  private onStdoutChunk(chunk: string) {
    this.stdoutBuffer += chunk;
    let nl = this.stdoutBuffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.stdoutBuffer.slice(0, nl).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      if (line) this.handleLine(line);
      nl = this.stdoutBuffer.indexOf('\n');
    }
  }

  private onStderrChunk(chunk: string) {
    this.stderrBuffer += chunk;
    let nl = this.stderrBuffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.stderrBuffer.slice(0, nl).trim();
      this.stderrBuffer = this.stderrBuffer.slice(nl + 1);
      if (line) {
        log('warn', `agent:${this.sessionId}`, line);
        this.emit('event', { type: 'stderr', line } as AgentEvent);
      }
      nl = this.stderrBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string) {
    let parsed: IncomingMessage | null = null;
    try {
      parsed = JSON.parse(line) as IncomingMessage;
    } catch {
      // Emit raw and move on.
    }

    this.emit('event', { type: 'output', line, parsed } as AgentEvent);

    if (parsed?.type === 'result') {
      this.turnStatus = 'awaiting_input';
    }

    if (!parsed || parsed.type !== 'control_request') return;
    const req = parsed.request as { subtype: string; [k: string]: unknown };
    if (req.subtype === 'can_use_tool') {
      this.handleCanUseTool(parsed.request_id, req as any);
    } else if (req.subtype === 'hook_callback') {
      this.handleHookCallback(parsed.request_id, req as any);
    }
  }

  private handleCanUseTool(
    requestId: string,
    req: { tool_name: string; input: unknown; tool_use_id?: string }
  ) {
    const approvalId = randomUUID();
    const pending: PendingApproval = {
      approvalId,
      toolName: req.tool_name,
      toolUseId: req.tool_use_id,
      input: req.input,
      createdAt: Date.now(),
      resolve: (result: PermissionResult) => {
        this.sendControlResponse({
          type: 'control_response',
          response: { subtype: 'success', request_id: requestId, response: result },
        });
      },
      reject: (err: Error) => {
        this.sendControlResponse({
          type: 'control_response',
          response: { subtype: 'error', request_id: requestId, error: err.message },
        });
      },
    };
    this.pendingApprovals.set(approvalId, pending);
    this.emit('event', {
      type: 'approval_request',
      approvalId,
      toolName: req.tool_name,
      input: req.input,
    } as AgentEvent);

    setTimeout(() => {
      if (this.pendingApprovals.has(approvalId)) {
        this.pendingApprovals.delete(approvalId);
        pending.resolve({
          behavior: 'deny',
          message: 'Approval request timed out',
          interrupt: true,
        });
      }
    }, APPROVAL_TIMEOUT_MS).unref?.();
  }

  private handleHookCallback(
    requestId: string,
    req: { callback_id: string; input: unknown; tool_use_id?: string }
  ) {
    if (req.callback_id === AUTO_APPROVE_CALLBACK) {
      this.sendControlResponse({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              permissionDecisionReason: 'Read-only tool, auto-approved',
            },
          },
        },
      });
      return;
    }
    // tool_approval (or any other callback we registered): forward to canusetool by replying "ask"
    this.sendControlResponse({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: 'Forwarding to claude-manager approval UI',
          },
        },
      },
    });
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null) {
    this.exited = true;
    log('info', `agent:${this.sessionId}`, 'exited', { code, signal });
    for (const pending of this.pendingApprovals.values()) {
      pending.resolve({
        behavior: 'deny',
        message: 'Agent exited before approval was given',
        interrupt: false,
      });
    }
    this.pendingApprovals.clear();
    this.emit('event', { type: 'exit', code, signal } as AgentEvent);
  }

  stop(signal: NodeJS.Signals = 'SIGTERM') {
    if (this.child && !this.exited) {
      try {
        this.child.kill(signal);
      } catch {
        // process may have already exited
      }
    }
  }

  isAlive() {
    return !this.exited && !!this.child;
  }

  pid(): number | null {
    return this.child?.pid ?? null;
  }
}
