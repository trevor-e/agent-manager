import { describe, it, expect, vi } from 'vitest';
import type { SessionRow } from '../db.ts';

const statusFor = vi.fn<(sessionId: string) => 'working' | 'awaiting_input' | 'awaiting_approval' | undefined>(
  () => undefined
);

vi.mock('../agent/manager.ts', () => ({
  agentManager: {
    statusFor: (id: string) => statusFor(id),
    ownedPids: () => new Set<number>(),
    ownedCwds: () => new Set<string>(),
  },
}));

const { deriveState } = await import('./state.ts');

function baseRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'sess-1',
    host: 'local',
    project_path: '/repo',
    repo_name: 'repo',
    jsonl_path: null,
    git_branch: null,
    title: null,
    auto_title: null,
    first_seen_at: Date.now(),
    last_event_at: Date.now(),
    last_event_type: null,
    last_prompt: null,
    file_mtime: null,
    file_size: null,
    user_status: 'active',
    pr_url: null,
    pr_number: null,
    pr_repository: null,
    pr_seen_at: null,
    queued_message: null,
    plan_mode: null,
    plan_file_path: null,
    auto_mode: null,
    launch_options: null,
    linear_issue_id: null,
    linear_issue_identifier: null,
    linear_issue_url: null,
    updated_at: Date.now(),
    ...overrides,
  };
}

describe('deriveState', () => {
  it('reports archived regardless of recency or a live working agent', () => {
    statusFor.mockReturnValue('working');
    const row = baseRow({ user_status: 'archived', last_event_at: Date.now() });
    expect(deriveState(row, new Set())).toBe('archived');
  });

  it('reports done ahead of a live agent status', () => {
    statusFor.mockReturnValue('awaiting_approval');
    const row = baseRow({ user_status: 'done' });
    expect(deriveState(row, new Set())).toBe('done');
  });

  it('reports launching when the last JSONL event type is "launching", even with no live agent yet', () => {
    statusFor.mockReturnValue(undefined);
    const row = baseRow({ last_event_type: 'launching', last_event_at: Date.now() - 10 * 60_000 });
    expect(deriveState(row, new Set())).toBe('launching');
  });

  it('maps a live "awaiting_approval" agent to blocked', () => {
    statusFor.mockReturnValue('awaiting_approval');
    const row = baseRow();
    expect(deriveState(row, new Set())).toBe('blocked');
  });

  it('maps a live "working" agent to working', () => {
    statusFor.mockReturnValue('working');
    const row = baseRow();
    expect(deriveState(row, new Set())).toBe('working');
  });

  it('maps a live "awaiting_input" agent to waiting', () => {
    statusFor.mockReturnValue('awaiting_input');
    const row = baseRow();
    expect(deriveState(row, new Set())).toBe('waiting');
  });

  it('falls back to JSONL heuristics when there is no live agent: recent last-prompt + running cwd is waiting', () => {
    statusFor.mockReturnValue(undefined);
    const row = baseRow({ last_event_type: 'last-prompt', last_event_at: Date.now() - 5_000 });
    expect(deriveState(row, new Set(['/repo']))).toBe('waiting');
  });

  it('falls back to JSONL heuristics: recent last-prompt with no running cwd is idle', () => {
    statusFor.mockReturnValue(undefined);
    const row = baseRow({ last_event_type: 'last-prompt', last_event_at: Date.now() - 5_000 });
    expect(deriveState(row, new Set())).toBe('idle');
  });

  it('falls back to JSONL heuristics: any other recent event type is working', () => {
    statusFor.mockReturnValue(undefined);
    const row = baseRow({ last_event_type: 'assistant', last_event_at: Date.now() - 5_000 });
    expect(deriveState(row, new Set())).toBe('working');
  });

  it('reports idle once the last event is older than the recent-activity window', () => {
    statusFor.mockReturnValue(undefined);
    const row = baseRow({ last_event_type: 'assistant', last_event_at: Date.now() - 3 * 60_000 });
    expect(deriveState(row, new Set(['/repo']))).toBe('idle');
  });
});
