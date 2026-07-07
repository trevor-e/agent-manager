import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, stat, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFromFile, decodeProjectDir, repoNameFromPath } from './jsonl.ts';

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

function attachmentEvent(type: string, timestamp: string, extra: Record<string, unknown> = {}) {
  return { type: 'attachment', timestamp, attachment: { type, ...extra } };
}

function prLinkEvent(timestamp: string, prUrl: string, prNumber: number, prRepository = 'org/repo') {
  return { type: 'pr-link', timestamp, prUrl, prNumber, prRepository };
}

function queueOpEvent(timestamp: string, operation: 'enqueue' | 'dequeue', content?: string) {
  return { type: 'queue-operation', timestamp, operation, content };
}

function systemEvent(timestamp: string) {
  return { type: 'system', timestamp };
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

  it('leaves planMode/autoMode null when no toggle is present in the window', async () => {
    const result = await extractLines([userEvent('hello')]);
    expect(result.planMode).toBeNull();
    expect(result.autoMode).toBeNull();
  });

  it('captures plan mode turning on, including the plan file path', async () => {
    const result = await extractLines([
      userEvent('hello'),
      attachmentEvent('plan_mode', '2026-07-06T12:00:01.000Z', { planFilePath: '/tmp/plan.md' }),
    ]);
    expect(result.planMode).toBe(true);
    expect(result.planFilePath).toBe('/tmp/plan.md');
  });

  it('prefers the most recent plan-mode toggle when walking the tail backwards', async () => {
    const result = await extractLines([
      userEvent('hello'),
      attachmentEvent('plan_mode', '2026-07-06T12:00:01.000Z'),
      attachmentEvent('plan_mode_exit', '2026-07-06T12:00:02.000Z'),
    ]);
    expect(result.planMode).toBe(false);
  });

  it('tracks auto mode independently from plan mode', async () => {
    const result = await extractLines([
      userEvent('hello'),
      attachmentEvent('auto_mode', '2026-07-06T12:00:01.000Z'),
      attachmentEvent('plan_mode_exit', '2026-07-06T12:00:02.000Z'),
    ]);
    expect(result.autoMode).toBe(true);
    expect(result.planMode).toBe(false);
  });

  it('ignores attachment types with no plan/auto mode signal', async () => {
    const result = await extractLines([
      userEvent('hello'),
      attachmentEvent('skill_listing', '2026-07-06T12:00:01.000Z'),
    ]);
    expect(result.planMode).toBeNull();
    expect(result.autoMode).toBeNull();
  });

  it('keeps the PR link with the latest timestamp regardless of file order', async () => {
    const result = await extractLines([
      prLinkEvent('2026-07-06T12:00:02.000Z', 'https://github.com/org/repo/pull/2', 2),
      prLinkEvent('2026-07-06T12:00:01.000Z', 'https://github.com/org/repo/pull/1', 1),
    ]);
    expect(result.prNumber).toBe(2);
    expect(result.prUrl).toBe('https://github.com/org/repo/pull/2');
  });

  it('does not let an equally-old or older pr-link overwrite the newest one', async () => {
    const result = await extractLines([
      prLinkEvent('2026-07-06T12:00:01.000Z', 'https://github.com/org/repo/pull/1', 1),
      prLinkEvent('2026-07-06T12:00:02.000Z', 'https://github.com/org/repo/pull/2', 2),
      prLinkEvent('2026-07-06T12:00:02.000Z', 'https://github.com/org/repo/pull/3', 3),
    ]);
    expect(result.prNumber).toBe(2);
  });

  it('reports a queued message when the trailing queue-operation is an enqueue', async () => {
    const result = await extractLines([
      userEvent('hello'),
      queueOpEvent('2026-07-06T12:00:01.000Z', 'enqueue', 'do the next thing'),
    ]);
    expect(result.queuedMessage).toBe('do the next thing');
  });

  it('clears the queued message once a later dequeue is seen', async () => {
    const result = await extractLines([
      userEvent('hello'),
      queueOpEvent('2026-07-06T12:00:01.000Z', 'enqueue', 'do the next thing'),
      queueOpEvent('2026-07-06T12:00:02.000Z', 'dequeue'),
    ]);
    expect(result.queuedMessage).toBeNull();
  });

  it('skips meta-only trailing events to find the real last event type', async () => {
    const result = await extractLines([
      userEvent('what is the weather today?'),
      systemEvent('2026-07-06T12:00:01.000Z'),
    ]);
    expect(result.lastEventType).toBe('user');
    expect(result.lastPromptText).toBe('what is the weather today?');
  });
});

describe('decodeProjectDir', () => {
  let root: string | null = null;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = null;
  });

  it('resolves a dash-encoded path against real directories, preferring the longest match', async () => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'jsonldecode')));
    root = tmp;
    // Two directories exist on disk that could plausibly satisfy segments
    // ["my", "project", "src"]: a merged "my-project" dir containing "src", and
    // an unrelated "my" dir. Only the "my-project/src" reading is fully valid.
    await mkdir(join(tmp, 'my-project', 'src'), { recursive: true });
    await mkdir(join(tmp, 'my'), { recursive: true });

    const encodedTmp = tmp.slice(1).split('/').join('-');
    const dirName = '-' + encodedTmp + '-my-project-src';

    expect(decodeProjectDir(dirName)).toBe(join(tmp, 'my-project', 'src'));
  });

  it('prefers a single merged directory name over a split match when both exist', async () => {
    const tmp = await realpath(await mkdtemp(join(tmpdir(), 'jsonldecode')));
    root = tmp;
    await mkdir(join(tmp, 'my-project-src'), { recursive: true });
    await mkdir(join(tmp, 'my-project', 'src'), { recursive: true });

    const encodedTmp = tmp.slice(1).split('/').join('-');
    const dirName = '-' + encodedTmp + '-my-project-src';

    expect(decodeProjectDir(dirName)).toBe(join(tmp, 'my-project-src'));
  });

  it('falls back to naive dash-to-slash reconstruction when nothing on disk matches', () => {
    expect(decodeProjectDir('-some-totally-nonexistent-path-xyz')).toBe('/some/totally/nonexistent/path/xyz');
  });
});

describe('repoNameFromPath', () => {
  it('returns the final path segment as the repo name', () => {
    expect(repoNameFromPath('/Users/dev/my-repo')).toBe('my-repo');
  });

  it('resolves a worktree path to the root repo name', () => {
    expect(repoNameFromPath('/Users/dev/my-repo/.claude/worktrees/feature-x')).toBe('my-repo');
  });
});
