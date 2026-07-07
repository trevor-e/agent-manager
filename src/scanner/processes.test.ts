import { describe, it, expect } from 'vitest';
import { etimeToMs, isClaudeProcess } from './processes.ts';

describe('etimeToMs', () => {
  it('parses mm:ss', () => {
    expect(etimeToMs('05:30')).toBe((5 * 60 + 30) * 1000);
  });

  it('parses hh:mm:ss', () => {
    expect(etimeToMs('01:02:03')).toBe((3600 + 2 * 60 + 3) * 1000);
  });

  it('parses dd-hh:mm:ss', () => {
    expect(etimeToMs('2-03:04:05')).toBe((2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000);
  });

  it('handles single-digit seconds/minutes', () => {
    expect(etimeToMs('00:05')).toBe(5000);
  });

  it('returns 0 for an unparsable string', () => {
    expect(etimeToMs('not-an-etime')).toBe(0);
  });

  it('returns 0 for an empty string', () => {
    expect(etimeToMs('')).toBe(0);
  });
});

describe('isClaudeProcess', () => {
  it('matches a bare "claude" command', () => {
    expect(isClaudeProcess('claude -p "do something"')).toBe(true);
  });

  it('matches an absolute path to the claude binary', () => {
    expect(isClaudeProcess('/Users/someone/.local/bin/claude --resume abc123')).toBe(true);
  });

  it('does not match a different binary', () => {
    expect(isClaudeProcess('node /some/claude-wrapper.js')).toBe(false);
  });

  it('does not match a command whose name merely contains "claude"', () => {
    expect(isClaudeProcess('claude-helper --daemon')).toBe(false);
  });

  it('returns false for an empty command', () => {
    expect(isClaudeProcess('')).toBe(false);
  });
});
