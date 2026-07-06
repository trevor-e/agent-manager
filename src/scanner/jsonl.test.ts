import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFromFile } from './jsonl.ts';

let dir: string | null = null;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

async function extractLines(lines: unknown[]): Promise<Awaited<ReturnType<typeof extractFromFile>>> {
  dir = await mkdtemp(join(tmpdir(), 'jsonl-test-'));
  const path = join(dir, 'session.jsonl');
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  await writeFile(path, content, 'utf8');
  const { size } = await stat(path);
  return extractFromFile(path, size);
}

function userEvent(content: string) {
  return { type: 'user', timestamp: '2026-07-06T12:00:00.000Z', message: { role: 'user', content } };
}

describe('extractFromFile', () => {
  it('extracts a plain last user prompt verbatim', async () => {
    const result = await extractLines([userEvent('first prompt'), userEvent('what is the weather today?')]);
    expect(result.lastEventType).toBe('user');
    expect(result.lastPromptText).toBe('what is the weather today?');
  });

  it('summarizes a trailing task-notification instead of dumping the raw XML', async () => {
    const notification =
      '<task-notification>\n<task-id>abc123</task-id>\n<status>completed</status>\n' +
      '<summary>Agent "Map price services" finished</summary>\n<result>...long result...</result>\n' +
      '</task-notification>';
    const result = await extractLines([userEvent('first prompt'), userEvent(notification)]);
    expect(result.lastEventType).toBe('user');
    expect(result.lastPromptText).toBe('Agent "Map price services" finished');
  });

  it('falls back to a generic label when a task-notification has no summary tag', async () => {
    const notification = '<task-notification>\n<task-id>abc123</task-id>\n<status>completed</status>\n</task-notification>';
    const result = await extractLines([userEvent(notification)]);
    expect(result.lastPromptText).toBe('Background task finished.');
  });

  it('strips local-command wrapper tags from the first user prompt', async () => {
    const wrapped =
      '<local-command-caveat>some caveat text</local-command-caveat>' +
      '<command-name>/review</command-name>' +
      '<command-message>review the diff</command-message>' +
      '<command-args></command-args>';
    const result = await extractLines([userEvent(wrapped)]);
    expect(result.firstUserPrompt).toBe('(/review)');
  });

  it('unwraps local-command stdout/stderr into the last prompt text', async () => {
    const wrapped = '<local-command-stdout>build succeeded</local-command-stdout>';
    const result = await extractLines([userEvent('first prompt'), userEvent(wrapped)]);
    expect(result.lastPromptText).toBe('build succeeded');
  });
});
