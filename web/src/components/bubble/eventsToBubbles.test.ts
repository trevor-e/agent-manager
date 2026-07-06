import { describe, it, expect } from 'vitest';
import { eventsToBubbles } from './eventsToBubbles.ts';
import type { ToolUseBubble, UserBubble, SystemBubble, AssistantBubble } from './types.ts';

function userEvent(content: unknown) {
  return { type: 'user', message: { role: 'user', content } };
}

function assistantEvent(content: unknown) {
  return { type: 'assistant', message: { role: 'assistant', content } };
}

describe('eventsToBubbles', () => {
  it('renders a plain user prompt as-is', () => {
    const bubbles = eventsToBubbles([userEvent('hello there')]);
    expect(bubbles).toHaveLength(1);
    expect((bubbles[0] as UserBubble).kind).toBe('user');
    expect((bubbles[0] as UserBubble).text).toBe('hello there');
  });

  it('strips local-command wrapper tags out of a user bubble', () => {
    const wrapped =
      '<local-command-caveat>caveat</local-command-caveat>' +
      '<command-name>/review</command-name>' +
      '<command-message>review the diff</command-message>' +
      '<command-args></command-args>';
    const bubbles = eventsToBubbles([userEvent(wrapped)]);
    expect(bubbles).toHaveLength(1);
    expect((bubbles[0] as UserBubble).text).toBe('(/review)');
  });

  it('pairs a tool_use with its tool_result', () => {
    const bubbles = eventsToBubbles([
      assistantEvent([{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }]),
      userEvent([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file1\nfile2' }]),
    ]);
    const tool = bubbles.find(b => b.kind === 'tool_use') as ToolUseBubble;
    expect(tool).toBeDefined();
    expect(tool.status).toBe('completed');
    expect(tool.result).toBe('file1\nfile2');
  });

  it('suppresses a task-notification when its originating tool_use is in the transcript', () => {
    const notification =
      '<task-notification>\n<tool-use-id>tu_1</tool-use-id>\n<status>completed</status>\n' +
      '<summary>Agent "Map services" finished</summary>\n<result>long result</result>\n</task-notification>';
    const bubbles = eventsToBubbles([
      assistantEvent([{ type: 'tool_use', id: 'tu_1', name: 'Task', input: {} }]),
      userEvent(notification),
    ]);
    expect(bubbles.some(b => b.kind === 'user')).toBe(false);
    expect(bubbles.some(b => b.kind === 'system')).toBe(false);
    expect(bubbles).toHaveLength(1);
  });

  it('shows a compact system note for a task-notification with no matching tool_use', () => {
    const notification =
      '<task-notification>\n<tool-use-id>tu_missing</tool-use-id>\n<status>completed</status>\n' +
      '<summary>Agent "Map services" finished</summary>\n</task-notification>';
    const bubbles = eventsToBubbles([userEvent(notification)]);
    expect(bubbles).toHaveLength(1);
    const bubble = bubbles[0] as SystemBubble;
    expect(bubble.kind).toBe('system');
    expect(bubble.text).toBe('Agent "Map services" finished');
  });

  it('never dumps the raw task-notification tags into a user bubble', () => {
    const notification = '<task-notification>\n<status>completed</status>\n</task-notification>';
    const bubbles = eventsToBubbles([userEvent(notification)]);
    for (const b of bubbles) {
      if ('text' in b) expect(b.text).not.toContain('<task-notification>');
    }
  });

  it('renders assistant text and tool_use in order', () => {
    const bubbles = eventsToBubbles([
      assistantEvent([
        { type: 'text', text: 'looking into it' },
        { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: 'a.ts' } },
      ]),
    ]);
    expect(bubbles.map(b => b.kind)).toEqual(['assistant', 'tool_use']);
    expect((bubbles[0] as AssistantBubble).text).toBe('looking into it');
  });
});
