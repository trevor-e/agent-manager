import { readdir, stat, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { upsertSession, db } from '../db.ts';
import { config } from '../config.ts';

const META_TYPES = new Set([
  'permission-mode',
  'pr-link',
  'system',
  'ai-title',
  'agent-name',
  'custom-title',
  'file-history-snapshot',
]);

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 32 * 1024;

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
};

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

function cleanPrompt(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
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
            if (text) result.lastPromptText = text;
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
  return result;
}

const getFileMetaStmt = db.prepare(
  'SELECT file_mtime, file_size, auto_title, jsonl_path, pr_seen_at FROM sessions WHERE id = ?'
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

      const projectPathFromCwd = extracted.cwd ?? decodeProjectDir(projectDir);
      const repoName = projectPathFromCwd.split('/').filter(Boolean).pop() ?? projectDir;
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
        updated_at: now,
      });
      updated++;
    }
  }

  return { scanned, updated };
}

export function decodeProjectDir(dirName: string): string {
  return '/' + dirName.replace(/^-/, '').replaceAll('-', '/');
}
