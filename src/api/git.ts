import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileP = promisify(execFile);

const GIT = 'git';
const GIT_TIMEOUT_MS = 15_000;
const GIT_BUF = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 1_000_000;
const MAX_DIFF_BYTES = 2_000_000;

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

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP(GIT, args, {
    cwd,
    maxBuffer: GIT_BUF,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout;
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const out = await tryGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return out !== null && out.trim() === 'true';
}

async function currentBranch(cwd: string): Promise<string | null> {
  const out = await tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!out) return null;
  const v = out.trim();
  return v && v !== 'HEAD' ? v : null;
}

async function resolveBaseRef(cwd: string): Promise<string | null> {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const ok = await tryGit(cwd, ['rev-parse', '--verify', '--quiet', ref]);
    if (ok !== null) return ref;
  }
  return null;
}

async function mergeBase(cwd: string, ref: string): Promise<string | null> {
  const out = await tryGit(cwd, ['merge-base', 'HEAD', ref]);
  return out ? out.trim() || null : null;
}

export function isBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8000);
  for (let i = 0; i < limit; i++) if (buf[i] === 0) return true;
  return false;
}

export function formatAddOnlyDiff(filePath: string, text: string): string {
  const trailing = text.endsWith('\n');
  const body = trailing ? text.slice(0, -1) : text;
  const lines = body.length === 0 ? [] : body.split('\n');
  const head =
    `diff --git a/${filePath} b/${filePath}\n` +
    `new file\n` +
    `--- /dev/null\n` +
    `+++ b/${filePath}\n` +
    `@@ -0,0 +1,${lines.length} @@\n`;
  const content = lines.map((l) => '+' + l).join('\n');
  if (lines.length === 0) return head;
  if (trailing) return head + content + '\n';
  return head + content + '\n\\ No newline at end of file\n';
}

export type PorcelainEntry = {
  path: string;
  oldPath: string | null;
  status: FileChange['status'];
};

export function parsePorcelainZ(out: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = [];
  const parts = out.split('\0');
  let i = 0;
  while (i < parts.length) {
    const head = parts[i];
    if (!head) { i++; continue; }
    const xy = head.slice(0, 2);
    const filePath = head.slice(3);
    if (xy === '??') {
      entries.push({ path: filePath, oldPath: null, status: '??' });
      i++;
      continue;
    }
    // Renames/copies have a second "from" path token after this entry
    const idx = xy.indexOf('R') !== -1 ? 'R' : xy.indexOf('C') !== -1 ? 'C' : null;
    if (idx) {
      const from = parts[i + 1] ?? '';
      entries.push({ path: filePath, oldPath: from, status: idx as 'R' | 'C' });
      i += 2;
      continue;
    }
    const code = xy.trim() || 'M';
    const ch = code[0] as FileChange['status'];
    entries.push({ path: filePath, oldPath: null, status: ch });
    i++;
  }
  return entries;
}

export type Numstat = { additions: number; deletions: number; binary: boolean };

export function parseNumstat(out: string, target: string): Numstat {
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [a, d, p] = line.split('\t');
    if (p && p === target) {
      const binary = a === '-' || d === '-';
      return {
        additions: binary ? 0 : Number(a) || 0,
        deletions: binary ? 0 : Number(d) || 0,
        binary,
      };
    }
  }
  return { additions: 0, deletions: 0, binary: false };
}

export function clampDiff(diff: string): { diff: string; truncated: boolean } {
  if (diff.length > MAX_DIFF_BYTES) {
    return { diff: diff.slice(0, MAX_DIFF_BYTES), truncated: true };
  }
  return { diff, truncated: false };
}

async function untrackedFileChange(cwd: string, relPath: string): Promise<FileChange> {
  const filePath = path.join(cwd, relPath);
  const base: FileChange = {
    path: relPath,
    oldPath: null,
    status: '??',
    additions: 0,
    deletions: 0,
    binary: false,
    diff: '',
    truncated: false,
  };
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return base;
    if (st.size > MAX_FILE_BYTES) return { ...base, truncated: true };
    const buf = await readFile(filePath);
    if (isBinary(buf)) return { ...base, binary: true };
    const text = buf.toString('utf8');
    const additions = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return { ...base, additions, diff: formatAddOnlyDiff(relPath, text) };
  } catch {
    return base;
  }
}

async function trackedDiff(
  cwd: string,
  baseArgs: string[],
  filePath: string
): Promise<{ diff: string; truncated: boolean; binary: boolean; additions: number; deletions: number }> {
  const numstatOut = await tryGit(cwd, ['diff', '--numstat', ...baseArgs, '--', filePath]);
  const stats = numstatOut ? parseNumstat(numstatOut, filePath) : { additions: 0, deletions: 0, binary: false };
  if (stats.binary) {
    return { diff: '', truncated: false, ...stats };
  }
  const raw = (await tryGit(cwd, ['diff', '--no-color', ...baseArgs, '--', filePath])) ?? '';
  const { diff, truncated } = clampDiff(raw);
  return { diff, truncated, ...stats };
}

export async function getWorkingChanges(cwd: string): Promise<GitChanges> {
  if (!(await isGitRepo(cwd))) {
    return { isRepo: false, mode: 'working', branch: null, baseRef: null, ahead: 0, files: [] };
  }
  const branch = await currentBranch(cwd);
  const statusOut = (await tryGit(cwd, ['status', '--porcelain=v1', '-uall', '-z'])) ?? '';
  const entries = parsePorcelainZ(statusOut);

  const files: FileChange[] = [];
  for (const e of entries) {
    if (e.status === '??') {
      files.push(await untrackedFileChange(cwd, e.path));
      continue;
    }
    const target = e.path;
    const stats = await trackedDiff(cwd, ['HEAD'], target);
    const fc: FileChange = {
      path: target,
      oldPath: e.oldPath,
      status: e.status,
      ...stats,
    };
    files.push(fc);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { isRepo: true, mode: 'working', branch, baseRef: null, ahead: 0, files };
}

export async function getBranchChanges(cwd: string): Promise<GitChanges> {
  if (!(await isGitRepo(cwd))) {
    return { isRepo: false, mode: 'branch', branch: null, baseRef: null, ahead: 0, files: [] };
  }
  const branch = await currentBranch(cwd);
  const baseRef = await resolveBaseRef(cwd);
  if (!baseRef) {
    return {
      isRepo: true,
      mode: 'branch',
      branch,
      baseRef: null,
      ahead: 0,
      files: [],
      warning: 'no main/master branch found',
    };
  }
  const base = await mergeBase(cwd, baseRef);
  if (!base) {
    return {
      isRepo: true,
      mode: 'branch',
      branch,
      baseRef,
      ahead: 0,
      files: [],
      warning: `no merge-base with ${baseRef}`,
    };
  }

  let ahead = 0;
  const aheadOut = await tryGit(cwd, ['rev-list', '--count', `${base}..HEAD`]);
  if (aheadOut) ahead = Number(aheadOut.trim()) || 0;

  // Tracked changes vs merge-base (includes committed + working tree).
  const numstatOut = (await tryGit(cwd, ['diff', '--numstat', base])) ?? '';
  const tracked: { path: string; stats: Numstat }[] = [];
  for (const line of numstatOut.split('\n')) {
    if (!line.trim()) continue;
    const [a, d, p] = line.split('\t');
    if (!p) continue;
    const binary = a === '-' || d === '-';
    tracked.push({
      path: p,
      stats: {
        additions: binary ? 0 : Number(a) || 0,
        deletions: binary ? 0 : Number(d) || 0,
        binary,
      },
    });
  }

  // Status for each path (M/A/D) using name-status against the merge-base.
  const nameStatusOut = (await tryGit(cwd, ['diff', '--name-status', base])) ?? '';
  const statusByPath = new Map<string, FileChange['status']>();
  for (const line of nameStatusOut.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const code = cols[0]?.[0] ?? 'M';
    if (code === 'R' || code === 'C') {
      // R/C lines have the form: R100\tfrom\tto
      const to = cols[2];
      if (to) statusByPath.set(to, code as FileChange['status']);
    } else {
      const p = cols[1];
      if (p) statusByPath.set(p, code as FileChange['status']);
    }
  }

  const files: FileChange[] = [];
  for (const t of tracked) {
    const raw = t.stats.binary ? '' : ((await tryGit(cwd, ['diff', '--no-color', base, '--', t.path])) ?? '');
    const { diff, truncated } = clampDiff(raw);
    files.push({
      path: t.path,
      oldPath: null,
      status: statusByPath.get(t.path) ?? 'M',
      additions: t.stats.additions,
      deletions: t.stats.deletions,
      binary: t.stats.binary,
      diff,
      truncated,
    });
  }

  // Untracked files (not yet staged) — show as additions.
  const untrackedOut = (await tryGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])) ?? '';
  for (const p of untrackedOut.split('\0')) {
    if (!p) continue;
    if (statusByPath.has(p)) continue;
    files.push(await untrackedFileChange(cwd, p));
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { isRepo: true, mode: 'branch', branch, baseRef, ahead, files };
}
