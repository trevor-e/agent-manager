import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA_VERSION = 4;

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    host            TEXT NOT NULL DEFAULT 'local',
    project_path    TEXT NOT NULL,
    repo_name       TEXT NOT NULL,
    jsonl_path      TEXT,
    git_branch      TEXT,
    title           TEXT,
    auto_title      TEXT,
    first_seen_at   INTEGER NOT NULL,
    last_event_at   INTEGER NOT NULL,
    last_event_type TEXT,
    last_prompt     TEXT,
    file_mtime      INTEGER,
    file_size       INTEGER,
    user_status     TEXT NOT NULL DEFAULT 'active',
    pr_url          TEXT,
    pr_number       INTEGER,
    pr_repository   TEXT,
    pr_seen_at      INTEGER,
    updated_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_status_last ON sessions(user_status, last_event_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_repo        ON sessions(repo_name);
  CREATE INDEX IF NOT EXISTS idx_sessions_project     ON sessions(project_path);

  CREATE TABLE IF NOT EXISTS running_processes (
    pid          INTEGER PRIMARY KEY,
    cwd          TEXT NOT NULL,
    started_at   INTEGER NOT NULL,
    observed_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_processes_cwd ON running_processes(cwd);
`);

function addColumnIfMissing(table: string, column: string, def: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  } catch (err) {
    if (!String(err).includes('duplicate column name')) throw err;
  }
}
addColumnIfMissing('sessions', 'pr_url', 'TEXT');
addColumnIfMissing('sessions', 'pr_number', 'INTEGER');
addColumnIfMissing('sessions', 'pr_repository', 'TEXT');
addColumnIfMissing('sessions', 'pr_seen_at', 'INTEGER');
addColumnIfMissing('sessions', 'launch_options', 'TEXT');
addColumnIfMissing('running_processes', 'session_id', 'TEXT');
addColumnIfMissing('sessions', 'parent_session_id', 'TEXT');
addColumnIfMissing('sessions', 'linear_issue_id', 'TEXT');
addColumnIfMissing('sessions', 'linear_issue_identifier', 'TEXT');
addColumnIfMissing('sessions', 'linear_issue_url', 'TEXT');

const prevVersion = (db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as
  | { value: string }
  | undefined)?.value;
if (prevVersion !== String(SCHEMA_VERSION)) {
  db.prepare('UPDATE sessions SET file_mtime = NULL').run();
  db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)')
    .run('schema_version', String(SCHEMA_VERSION));
}

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    title, auto_title, last_prompt,
    content=sessions, content_rowid=rowid
  );

  CREATE TRIGGER IF NOT EXISTS sessions_fts_ai AFTER INSERT ON sessions BEGIN
    INSERT INTO sessions_fts(rowid, title, auto_title, last_prompt)
    VALUES (new.rowid, new.title, new.auto_title, new.last_prompt);
  END;

  CREATE TRIGGER IF NOT EXISTS sessions_fts_ad AFTER DELETE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, title, auto_title, last_prompt)
    VALUES ('delete', old.rowid, old.title, old.auto_title, old.last_prompt);
  END;

  CREATE TRIGGER IF NOT EXISTS sessions_fts_au AFTER UPDATE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, title, auto_title, last_prompt)
    VALUES ('delete', old.rowid, old.title, old.auto_title, old.last_prompt);
    INSERT INTO sessions_fts(rowid, title, auto_title, last_prompt)
    VALUES (new.rowid, new.title, new.auto_title, new.last_prompt);
  END;
`);

if (prevVersion !== String(SCHEMA_VERSION)) {
  db.exec("INSERT INTO sessions_fts(sessions_fts) VALUES('rebuild')");
}

export type SessionRow = {
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
  file_mtime: number | null;
  file_size: number | null;
  user_status: 'active' | 'done' | 'archived';
  pr_url: string | null;
  pr_number: number | null;
  pr_repository: string | null;
  pr_seen_at: number | null;
  launch_options: string | null;
  linear_issue_id: string | null;
  linear_issue_identifier: string | null;
  linear_issue_url: string | null;
  updated_at: number;
};

export type LaunchOptions = {
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'auto' | 'dontAsk';
  worktree?: { enabled: boolean; name?: string };
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  addDirs?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
  forkFrom?: string;
  linearIssueId?: string;
};

export type ProcessRow = {
  pid: number;
  cwd: string;
  session_id: string | null;
  started_at: number;
  observed_at: number;
};

const upsertSessionStmt = db.prepare(`
  INSERT INTO sessions (
    id, host, project_path, repo_name, jsonl_path, git_branch,
    auto_title, first_seen_at, last_event_at, last_event_type,
    last_prompt, file_mtime, file_size,
    pr_url, pr_number, pr_repository, pr_seen_at,
    updated_at
  ) VALUES (
    @id, @host, @project_path, @repo_name, @jsonl_path, @git_branch,
    @auto_title, @first_seen_at, @last_event_at, @last_event_type,
    @last_prompt, @file_mtime, @file_size,
    @pr_url, @pr_number, @pr_repository, @pr_seen_at,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    project_path    = excluded.project_path,
    repo_name       = excluded.repo_name,
    jsonl_path      = excluded.jsonl_path,
    git_branch      = COALESCE(excluded.git_branch, sessions.git_branch),
    auto_title      = COALESCE(excluded.auto_title, sessions.auto_title),
    last_event_at   = excluded.last_event_at,
    last_event_type = excluded.last_event_type,
    last_prompt     = excluded.last_prompt,
    file_mtime      = excluded.file_mtime,
    file_size       = excluded.file_size,
    pr_url          = CASE WHEN excluded.pr_seen_at IS NOT NULL
                            AND (sessions.pr_seen_at IS NULL OR excluded.pr_seen_at >= sessions.pr_seen_at)
                           THEN excluded.pr_url ELSE sessions.pr_url END,
    pr_number       = CASE WHEN excluded.pr_seen_at IS NOT NULL
                            AND (sessions.pr_seen_at IS NULL OR excluded.pr_seen_at >= sessions.pr_seen_at)
                           THEN excluded.pr_number ELSE sessions.pr_number END,
    pr_repository   = CASE WHEN excluded.pr_seen_at IS NOT NULL
                            AND (sessions.pr_seen_at IS NULL OR excluded.pr_seen_at >= sessions.pr_seen_at)
                           THEN excluded.pr_repository ELSE sessions.pr_repository END,
    pr_seen_at      = COALESCE(MAX(excluded.pr_seen_at, sessions.pr_seen_at), excluded.pr_seen_at, sessions.pr_seen_at),
    updated_at      = excluded.updated_at
`);

export type UpsertSessionInput = Omit<SessionRow, 'title' | 'user_status' | 'notes' | 'launch_options' | 'linear_issue_id' | 'linear_issue_identifier' | 'linear_issue_url'>;

export function upsertSession(row: UpsertSessionInput) {
  upsertSessionStmt.run(row);
}

export const insertLaunchPlaceholderStmt = db.prepare(`
  INSERT INTO sessions (
    id, host, project_path, repo_name, jsonl_path, git_branch,
    title, auto_title, first_seen_at, last_event_at, last_event_type,
    last_prompt, file_mtime, file_size, user_status, notes,
    pr_url, pr_number, pr_repository, pr_seen_at,
    launch_options,
    linear_issue_id, linear_issue_identifier, linear_issue_url,
    updated_at
  ) VALUES (
    @id, 'local', @project_path, @repo_name, NULL, NULL,
    @title, NULL, @now, @now, 'launching',
    NULL, NULL, NULL, 'active', NULL,
    NULL, NULL, NULL, NULL,
    @launch_options,
    @linear_issue_id, @linear_issue_identifier, @linear_issue_url,
    @now
  )
`);

export function getLaunchOptions(id: string): LaunchOptions | null {
  const row = db
    .prepare('SELECT launch_options FROM sessions WHERE id = ?')
    .get(id) as { launch_options: string | null } | undefined;
  if (!row?.launch_options) return null;
  try {
    return JSON.parse(row.launch_options) as LaunchOptions;
  } catch {
    return null;
  }
}

export function setUserStatus(id: string, status: 'active' | 'done' | 'archived') {
  db.prepare('UPDATE sessions SET user_status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id);
}

export function setTitle(id: string, title: string | null) {
  db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, Date.now(), id);
}

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string | null) {
  if (value === null || value === '') {
    db.prepare('DELETE FROM schema_meta WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)').run(key, value);
  }
}

export function setNotes(id: string, notes: string | null) {
  db.prepare('UPDATE sessions SET notes = ?, updated_at = ? WHERE id = ?')
    .run(notes, Date.now(), id);
}

export function getSession(id: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

export function listSessions(opts: { status?: string; repo?: string; q?: string } = {}): SessionRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  let useFts = false;
  if (opts.status && opts.status !== 'all') {
    if (opts.status === 'active') {
      where.push("user_status = 'active'");
    } else {
      where.push('user_status = @status');
      params.status = opts.status;
    }
  }
  if (opts.repo) {
    where.push('repo_name = @repo');
    params.repo = opts.repo;
  }
  if (opts.q) {
    useFts = true;
    params.q = opts.q;
  }
  if (useFts) {
    try {
      const ftsWhere = where.length ? 'AND ' + where.join(' AND ') : '';
      const sql = `SELECT s.* FROM sessions s JOIN sessions_fts f ON s.rowid = f.rowid WHERE sessions_fts MATCH @q ${ftsWhere} ORDER BY s.last_event_at DESC LIMIT 1000`;
      return db.prepare(sql).all(params) as SessionRow[];
    } catch {
      where.push('(title LIKE @qlike OR auto_title LIKE @qlike OR last_prompt LIKE @qlike)');
      params.qlike = `%${opts.q}%`;
      delete params.q;
    }
  }
  const sql = `SELECT * FROM sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY last_event_at DESC LIMIT 1000`;
  return db.prepare(sql).all(params) as SessionRow[];
}

export function listRunningCwds(): Set<string> {
  const rows = db.prepare('SELECT DISTINCT cwd FROM running_processes').all() as { cwd: string }[];
  return new Set(rows.map(r => r.cwd));
}

export function replaceRunningProcesses(rows: ProcessRow[]) {
  const tx = db.transaction((rows: ProcessRow[]) => {
    db.prepare('DELETE FROM running_processes').run();
    const ins = db.prepare(`
      INSERT INTO running_processes (pid, cwd, session_id, started_at, observed_at)
      VALUES (@pid, @cwd, @session_id, @started_at, @observed_at)
    `);
    for (const r of rows) ins.run(r);
  });
  tx(rows);
}
