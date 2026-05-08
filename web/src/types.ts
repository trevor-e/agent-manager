export type DerivedState =
  | 'launching'
  | 'working'
  | 'waiting'
  | 'blocked'
  | 'idle'
  | 'done'
  | 'archived';

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUSD: number;
};

export type Session = {
  id: string;
  host: string;
  project_path: string;
  repo_name: string;
  jsonl_path: string | null;
  git_branch: string | null;
  title: string | null;
  auto_title: string | null;
  first_seen_at: number;
  last_event_at: number;
  last_event_type: string | null;
  last_prompt: string | null;
  user_status: 'active' | 'done' | 'archived';
  pr_url: string | null;
  pr_number: number | null;
  pr_repository: string | null;
  pr_seen_at: number | null;
  linear_issue_id: string | null;
  linear_issue_identifier: string | null;
  linear_issue_url: string | null;
  derived_state: DerivedState;
  display_name: string;
  is_running: boolean;
  web_chat_locked: boolean;
  usage?: UsageTotals | null;
  tool_usage?: Record<string, number> | null;
};

export type RepoSummary = {
  repo_name: string;
  project_path: string;
  total: number;
  by_state: Record<string, number>;
};

export type SessionEvent = Record<string, unknown> & { type?: string };

export type FileChange = {
  path: string;
  oldPath: string | null;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '??';
  additions: number;
  deletions: number;
  binary: boolean;
  diff: string;
  truncated: boolean;
};

export type GitChanges = {
  isRepo: boolean;
  mode: 'working' | 'branch';
  branch: string | null;
  baseRef: string | null;
  ahead: number;
  files: FileChange[];
  warning?: string;
};

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'auto'
  | 'dontAsk';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type LaunchOptions = {
  permissionMode?: PermissionMode;
  worktree?: { enabled: boolean; name?: string };
  model?: string;
  effort?: EffortLevel;
  addDirs?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
  linearIssueId?: string;
};

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  url: string;
  state: { id: string; name: string; type: string };
  assignee: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  labels: { id: string; name: string }[];
};

export type LinearProject = {
  id: string;
  name: string;
  issueCount: number;
};
