export type {
  DerivedState,
  PermissionMode,
  EffortLevel,
  LaunchOptions,
  UsageTotals,
} from '../../src/shared/types.ts';

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
  queued_message: string | null;
  plan_mode: number | null;
  plan_file_path: string | null;
  auto_mode: number | null;
  linear_issue_id: string | null;
  linear_issue_identifier: string | null;
  linear_issue_url: string | null;
  launch_options: string | null;
  derived_state: import('../../src/shared/types.ts').DerivedState;
  display_name: string;
  is_running: boolean;
  web_chat_locked: boolean;
  usage?: import('../../src/shared/types.ts').UsageTotals | null;
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

export type Workflow = {
  id: string;
  label: string;
  description: string | null;
  body: string;
  builtin: boolean;
  version: number;
  updated_at: number;
};
