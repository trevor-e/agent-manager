import { readdir, stat, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { upsertSession, setUserStatus, db } from '../db.ts';
import { config } from '../config.ts';

// Types skipped outright — no special handling, never allowed to set lastEventType.
// 'pr-link', 'attachment', and 'queue-operation' are NOT here: they get dedicated
// handling below (and still `continue`, so they never fall through either).
const META_TYPES = new Set([
  'permission-mode',
  'system',
  'ai-title',
  'agent-name',
  'custom-title',
  'file-history-snapshot',
  'mode',
]);

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 32 * 1024;

// attachment.type values that flip plan mode / auto mode on or off. Every other
// attachment.type (skill_listing, deferred_tools_delta, agent_listing_delta,
// mcp_instructions_delta, command_permissions, task_reminder, date_change,
// edited_text_file, queued_command, ...) is pure environment/context bookkeeping
// with no session-state signal, and is ignored.
const PLAN_MODE_ON = new Set(['plan_mode', 'plan_mode_reentry']);
const PLAN_MODE_OFF = new Set(['plan_mode_exit']);
const AUTO_MODE_ON = new Set(['auto_mode']);
const AUTO_MODE_OFF = new Set(['auto_mode_exit']);

type JsonlExtract = {
  cwd: string | null;
  gitBranch: string | null;
  aiTitle: string | null;
  customTitle: string | null;
  firstUserPrompt: string | null;
  lastEventType: string | null;
  lastPromptText: string | null;
  lastTimestampMs: number | null;
  prUrl: string | null;
  prNumber: number | null;
  prRepository: string | null;
  prSeenAtMs: number | null;
  queuedMessage: string | null;
  // null means "no plan_mode/auto_mode toggle seen in this scan's head/tail
  // window" — distinct from false ("we saw a toggle and it was OFF"), so the
  // caller can carry forward the last known value instead of clobbering it.
  // These are one-shot events (not re-emitted every turn), so on a long session
  // the toggle can easily scroll outside the tail window entirely.
  planMode: boolean | null;
  planFilePath: string | null;
  autoMode: boolean | null;
};

function modeAttachmentSignal(atType: string | undefined): { family: 'plan' | 'auto'; on: boolean } | null {
  if (!atType) return null;
  if (PLAN_MODE_ON.has(atType)) return { family: 'plan', on: true };
  if (PLAN_MODE_OFF.has(atType)) return { family: 'plan', on: false };
  if (AUTO_MODE_ON.has(atType)) return { family: 'auto', on: true };
  if (AUTO_MODE_OFF.has(atType)) return { family: 'auto', on: false };
  return null;
}

function maybeCapturePrLink(ev: Record<string, unknown>, result: JsonlExtract) {
  if (ev.type !== 'pr-link') return;
  const url = typeof ev.prUrl === 'string' ? ev.prUrl : null;
  if (!url) return;
  const ts = tsToMs(ev.timestamp) ?? 0;
  if (result.prSeenAtMs !== null && ts <= result.prSeenAtMs) return;
  result.prUrl = url;
  result.prNumber = typeof ev.prNumber === 'number' ? ev.prNumber : null;
  result.prRepository = typeof ev.prRepository === 'string' ? ev.prRepository : null;
  result.prSeenAtMs = ts;
}

function parseLineSafe(line: string): unknown | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function tsToMs(ts: unknown): number | null {
  if (typeof ts !== 'string') return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === 'object' && (c as any).type === 'text') {
        const t = (c as any).text;
        if (typeof t === 'string') return t;
      }
    }
  }
  return null;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function unwrapLocalCommandOutput(s: string): string {
  return stripAnsi(
    s
      .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, '$1')
      .replace(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/g, '$1'),
  );
}

function taskNotificationSummary(raw: string): string | null {
  const s = raw.trim();
  if (!s.startsWith('<task-notification>') || !s.endsWith('</task-notification>')) return null;
  return s.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() || 'Background task finished.';
}

function cleanPrompt(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  const notif = taskNotificationSummary(s);
  if (notif) return notif.length > 200 ? notif.slice(0, 200) : notif;
  if (s.startsWith('<local-command-caveat>')) {
    const close = s.indexOf('</local-command-caveat>');
    if (close >= 0) s = s.slice(close + '</local-command-caveat>'.length).trim();
  }
  const cmdMatch = s.match(/^<command-name>([^<]+)<\/command-name>/);
  if (cmdMatch) {
    const cmd = cmdMatch[1].trim();
    return `(${cmd})`;
  }
  s = s.replace(/<command-message>[\s\S]*?<\/command-message>/g, '');
  s = s.replace(/<command-args>[\s\S]*?<\/command-args>/g, '');
  s = unwrapLocalCommandOutput(s);
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > 200 ? s.slice(0, 200) : s;
}

async function extractFromFile(path: string, fileSize: number): Promise<JsonlExtract> {
  const result: JsonlExtract = {
    cwd: null,
    gitBranch: null,
    aiTitle: null,
    customTitle: null,
    firstUserPrompt: null,
    lastEventType: null,
    lastPromptText: null,
    lastTimestampMs: null,
    prUrl: null,
    prNumber: null,
    prRepository: null,
    prSeenAtMs: null,
    queuedMessage: null,
    planMode: null,
    planFilePath: null,
    autoMode: null,
  };

  const fh = await open(path, 'r');
  try {
    const headLen = Math.min(HEAD_BYTES, fileSize);
    const headBuf = Buffer.alloc(headLen);
    if (headLen > 0) await fh.read(headBuf, 0, headLen, 0);
    const headLines = headBuf.toString('utf8').split('\n');

    for (const line of headLines) {
      const o = parseLineSafe(line);
      if (!o || typeof o !== 'object') continue;
      const ev = o as Record<string, unknown>;

      if (!result.cwd && typeof ev.cwd === 'string') result.cwd = ev.cwd;
      if (!result.gitBranch && typeof ev.gitBranch === 'string') result.gitBranch = ev.gitBranch;

      if (ev.type === 'ai-title' && typeof ev.aiTitle === 'string') {
        if (!result.aiTitle) result.aiTitle = ev.aiTitle;
      }
      if (ev.type === 'custom-title' && typeof ev.customTitle === 'string') {
        result.customTitle = ev.customTitle;
      }

      maybeCapturePrLink(ev, result);

      // auto_mode in particular is a one-shot event fired near session start,
      // so it lives in the head window, not the tail — unlike plan_mode, which
      // is user-triggered and can happen at any point. Forward iteration means
      // the last match here is naturally the most recent one within the window;
      // the tail loop below still wins if it finds a fresher signal itself.
      if (ev.type === 'attachment') {
        const at = ev.attachment as Record<string, unknown> | undefined;
        const sig = modeAttachmentSignal(at && typeof at === 'object' ? (at.type as string | undefined) : undefined);
        if (sig?.family === 'plan') {
          result.planMode = sig.on;
          if (typeof at?.planFilePath === 'string') result.planFilePath = at.planFilePath;
        } else if (sig?.family === 'auto') {
          result.autoMode = sig.on;
        }
      }

      if (!result.firstUserPrompt && ev.type === 'user') {
        const msg = ev.message as Record<string, unknown> | undefined;
        if (msg && typeof msg === 'object') {
          const text = extractText(msg.content);
          const cleaned = cleanPrompt(text);
          if (cleaned) result.firstUserPrompt = cleaned;
        }
      }
    }

    const tailStart = Math.max(0, fileSize - TAIL_BYTES);
    const tailLen = fileSize - tailStart;
    let tailLines: string[] = [];
    if (tailLen > 0) {
      const tailBuf = Buffer.alloc(tailLen);
      await fh.read(tailBuf, 0, tailLen, tailStart);
      tailLines = tailBuf.toString('utf8').split('\n');
    }

    let queueOpSeen = false;
    let planModeSeen = false;
    let autoModeSeen = false;
    for (let i = tailLines.length - 1; i >= 0; i--) {
      const o = parseLineSafe(tailLines[i]);
      if (!o || typeof o !== 'object') continue;
      const ev = o as Record<string, unknown>;
      const t = ev.type as string | undefined;
      if (!t) continue;

      if (t === 'ai-title' && typeof ev.aiTitle === 'string') {
        if (!result.aiTitle) result.aiTitle = ev.aiTitle;
        continue;
      }
      if (t === 'custom-title' && typeof ev.customTitle === 'string') {
        if (!result.customTitle) result.customTitle = ev.customTitle;
        continue;
      }
      if (t === 'pr-link') {
        maybeCapturePrLink(ev, result);
        continue;
      }
      if (t === 'attachment') {
        // Most of these (skill_listing, deferred_tools_delta, task_reminder, ...)
        // are environment/context bookkeeping with no session-state signal.
        // plan_mode and auto_mode transitions are the exception — walking the
        // tail backwards, the first hit per family is the most recent one.
        const at = ev.attachment as Record<string, unknown> | undefined;
        const sig = modeAttachmentSignal(at && typeof at === 'object' ? (at.type as string | undefined) : undefined);
        if (sig?.family === 'plan' && !planModeSeen) {
          planModeSeen = true;
          result.planMode = sig.on;
          if (typeof at?.planFilePath === 'string') result.planFilePath = at.planFilePath;
        }
        if (sig?.family === 'auto' && !autoModeSeen) {
          autoModeSeen = true;
          result.autoMode = sig.on;
        }
        continue;
      }
      if (t === 'queue-operation') {
        // Most recent queue-operation wins (we're walking the tail backwards).
        // A trailing 'enqueue' with no later 'dequeue' means the message is
        // still sitting in the CLI's input queue, unconsumed.
        if (!queueOpSeen) {
          queueOpSeen = true;
          if (ev.operation === 'enqueue' && typeof ev.content === 'string') {
            result.queuedMessage = ev.content;
          }
        }
        continue;
      }
      if (META_TYPES.has(t)) continue;

      if (result.lastEventType === null) {
        result.lastEventType = t;
        const ts = tsToMs(ev.timestamp);
        if (ts !== null) result.lastTimestampMs = ts;

        if (t === 'last-prompt' && typeof ev.lastPrompt === 'string') {
          result.lastPromptText = ev.lastPrompt;
        } else {
          const msg = ev.message as Record<string, unknown> | undefined;
          if (msg && typeof msg === 'object') {
            const text = extractText(msg.content);
            if (text) result.lastPromptText = taskNotificationSummary(text) ?? unwrapLocalCommandOutput(text);
          }
        }
      }
    }
  } finally {
    await fh.close();
  }

  if (result.lastPromptText) {
    result.lastPromptText = result.lastPromptText.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  if (result.queuedMessage) {
    result.queuedMessage = unwrapLocalCommandOutput(result.queuedMessage).replace(/\s+/g, ' ').trim().slice(0, 240) || null;
  }
  return result;
}

const getFileMetaStmt = db.prepare(
  'SELECT file_mtime, file_size, auto_title, jsonl_path, pr_seen_at, user_status FROM sessions WHERE id = ?'
);

export async function scanJsonl(): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  const now = Date.now();

  let projectDirs: string[] = [];
  try {
    projectDirs = await readdir(config.projectsDir);
  } catch {
    return { scanned: 0, updated: 0 };
  }

  for (const projectDir of projectDirs) {
    if (!projectDir.startsWith('-')) continue;
    const projectPath = join(config.projectsDir, projectDir);
    let entries: string[];
    try {
      entries = await readdir(projectPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = join(projectPath, entry);
      const sessionId = basename(entry, '.jsonl');

      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(filePath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      scanned++;

      const fileMtime = Math.floor(st.mtimeMs);
      const fileSize = st.size;

      const existing = getFileMetaStmt.get(sessionId) as
        | {
            file_mtime: number | null;
            file_size: number | null;
            auto_title: string | null;
            jsonl_path: string | null;
            pr_seen_at: number | null;
            user_status: 'active' | 'done' | 'archived';
          }
        | undefined;

      const unchanged =
        existing &&
        existing.file_mtime === fileMtime &&
        existing.file_size === fileSize &&
        existing.jsonl_path === filePath &&
        existing.auto_title;

      if (unchanged) continue;

      let extracted: JsonlExtract;
      try {
        extracted = await extractFromFile(filePath, fileSize);
      } catch {
        continue;
      }

      const rawPath = extracted.cwd ?? decodeProjectDir(projectDir);
      const worktreeMatch = rawPath.match(/^(.+?)\/\.claude\/worktrees\/[^/]+$/);
      const projectPathFromCwd = worktreeMatch ? worktreeMatch[1] : rawPath;
      const repoName = repoNameFromPath(projectPathFromCwd);
      const autoTitle = extracted.customTitle ?? extracted.aiTitle ?? extracted.firstUserPrompt ?? null;
      const lastEventAt = extracted.lastTimestampMs ?? fileMtime;

      upsertSession({
        id: sessionId,
        host: 'local',
        project_path: projectPathFromCwd,
        repo_name: repoName,
        jsonl_path: filePath,
        git_branch: extracted.gitBranch,
        auto_title: autoTitle,
        first_seen_at: existing ? lastEventAt : (st.birthtimeMs ? Math.floor(st.birthtimeMs) : lastEventAt),
        last_event_at: lastEventAt,
        last_event_type: extracted.lastEventType,
        last_prompt: extracted.lastPromptText,
        file_mtime: fileMtime,
        file_size: fileSize,
        pr_url: extracted.prUrl,
        pr_number: extracted.prNumber,
        pr_repository: extracted.prRepository,
        pr_seen_at: extracted.prSeenAtMs,
        queued_message: extracted.queuedMessage,
        plan_mode: extracted.planMode === null ? null : (extracted.planMode ? 1 : 0),
        plan_file_path: extracted.planFilePath,
        auto_mode: extracted.autoMode === null ? null : (extracted.autoMode ? 1 : 0),
        updated_at: now,
      });
      if (existing && (existing.user_status === 'done' || existing.user_status === 'archived')) {
        setUserStatus(sessionId, 'active');
      }
      updated++;
    }
  }

  return { scanned, updated };
}

export function decodeProjectDir(dirName: string): string {
  const segments = dirName.replace(/^-/, '').split('-');
  const resolved = resolveSegments('/', segments);
  if (resolved) return resolved;
  return '/' + segments.join('/');
}

function resolveSegments(base: string, segments: string[]): string | null {
  if (segments.length === 0) return base;
  for (let take = segments.length; take >= 1; take--) {
    const name = segments.slice(0, take).join('-');
    const candidate = join(base, name);
    if (existsSync(candidate)) {
      const rest = resolveSegments(candidate, segments.slice(take));
      if (rest) return rest;
    }
  }
  return null;
}

export function repoNameFromPath(projectPath: string): string {
  const worktreeMatch = projectPath.match(/^(.+)\/\.claude\/worktrees\/[^/]+$/);
  const root = worktreeMatch ? worktreeMatch[1] : projectPath;
  return root.split('/').filter(Boolean).pop() ?? projectPath;
}
