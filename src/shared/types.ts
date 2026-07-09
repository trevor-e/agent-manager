export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'auto'
  | 'dontAsk';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type DerivedState =
  | 'launching'
  | 'working'
  | 'waiting'
  | 'blocked'
  | 'idle'
  | 'done'
  | 'archived';

export type LaunchOptions = {
  permissionMode?: PermissionMode;
  worktree?: { enabled: boolean; name?: string };
  model?: string;
  // Comma-separated list of models to try when the primary is overloaded or
  // unavailable (`claude --fallback-model`).
  fallbackModel?: string;
  effort?: EffortLevel;
  addDirs?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
  forkFrom?: string;
  linearIssueId?: string;
  // When set, the rendered workflow body is injected as the session's opening
  // message (web chat) or initial prompt (terminal). workflowArgs fills the
  // template's $ARGUMENTS placeholder.
  workflowId?: string;
  workflowArgs?: string;
};

export type SubagentSummary = {
  agentId: string;
  toolUseId: string | null;
  agentType: string | null;
  description: string | null;
};

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUSD: number;
  // Context window usage as of the most recent turn (not cumulative — unlike
  // the totals above, context size doesn't accumulate additively across turns).
  contextTokens?: number;
  contextWindow?: number;
};
