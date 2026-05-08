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
  derived_state: DerivedState;
  display_name: string;
  is_running: boolean;
  web_chat_locked: boolean;
  usage?: UsageTotals | null;
};

export type RepoSummary = {
  repo_name: string;
  project_path: string;
  total: number;
  by_state: Record<string, number>;
};

export type SessionEvent = Record<string, unknown> & { type?: string };
