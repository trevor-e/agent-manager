# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm dev` — build SPA once, then run server + Vite watch concurrently. Server at `http://localhost:7777`.
- `pnpm dev:server` — API + scanner only (`tsx watch src/server.ts`). Pair with `pnpm dev:web` (Vite at `:5173`, proxies `/api` → `:7777`) for frontend HMR.
- `pnpm build:web` — build SPA into `dist/`. The server serves `dist/` statically when present and falls back to a hint page if missing.
- `pnpm start` — run the server without watch.
- `pnpm bulk-done` — run `scripts/bulk-done.ts` (one-off DB maintenance script).
- `pnpm test` — run the Vitest suite (`vitest run`, config at `vitest.config.ts`). Covers both `src/**/*.test.ts` (server) and `web/src/**/*.test.ts` (frontend) — pure-function/parsing logic mainly (e.g. `src/scanner/jsonl.test.ts`, `web/src/components/bubble/eventsToBubbles.test.ts`).

There is no linter or typecheck script wired into npm scripts. `tsconfig.json` uses `noEmit: true` with `allowImportingTsExtensions` — all TS imports inside the repo use explicit `.ts`/`.tsx` extensions, run via `tsx`. Don't strip the extensions.

Package manager is **pnpm** (see `pnpm-workspace.yaml`); don't introduce npm/yarn lockfiles.

## Architecture

This is a single-process Fastify server + Vite-built React SPA that manages local Claude Code sessions across many repos. It's a desktop-style tool: server binds `127.0.0.1` only, talks to the local filesystem, local processes, and a local SQLite DB.

### Two ways a session is observed

The core data model has two distinct sources of truth that are reconciled per request:

1. **JSONL scanner** (`src/scanner/jsonl.ts`) — walks `~/.claude/projects/**/*.jsonl` (configurable via `CM_PROJECTS_DIR`) and upserts each session's metadata, last event, PR link, etc. into the `sessions` table. Reads only head + tail bytes of each JSONL for performance and skips files whose `mtime`+`size` are unchanged.
2. **Process scanner** (`src/scanner/processes.ts`) — `ps -axwwo` for `claude` processes, then `lsof` per pid to resolve `cwd` and the open `.jsonl` (which gives the live session id). Replaces `running_processes` table each tick.

Both run on every scan tick (default 5s, see `config.scanIntervalMs`) from `src/scanner/index.ts`. Don't add a third source of truth — extend one of these.

### Derived state

`src/api/state.ts` has the canonical `deriveState()` that turns `(SessionRow, runningCwds)` into one of `launching | working | waiting | blocked | idle | done | archived`. Order matters: live web-chat agents (`agentManager.statusFor`) win over JSONL inference, because the in-process agent knows its turn state precisely. JSONL-only sessions fall back to recency + `last_event_type` heuristics.

`runningCwdsExcludingOwn()` and `lockedSessionIdsExcludingOwn()` filter out our own spawned web-chat agent pids so the UI doesn't warn the user about themselves.

### Two ways a session is launched / driven

There are two distinct execution paths and they are not interchangeable:

- **Terminal launch** (`src/launcher/terminal.ts`) — spawns Ghostty via `open -na Ghostty.app` running the `claude` CLI in a new window. Used for `kind: 'new'`, `'resume'`, and `forkFrom`. Builds an argv with `--session-id` / `--resume` / `--fork-session` plus per-session `LaunchOptions` (model, effort, permission mode, worktree, system prompt, add-dirs).
- **Web-chat agent** (`src/agent/process.ts` + `src/agent/manager.ts`) — spawns a headless `claude -p` subprocess in `stream-json` mode with `--permission-prompt-tool stdio`, owned by the server. Stdout is parsed line-by-line; tool approvals are gated through `PreToolUse` hooks (read-only tools auto-approve, everything else requests user approval via SSE). Each agent is keyed by `sessionId`; the manager refcounts SSE listeners and stops the child after `agentIdleTimeoutMs` of no listeners (only after the current turn finishes).

Both paths use the same `LaunchOptions` shape stored on the session row (`launch_options` JSON column) so the resume of a forked or option-customized session re-applies the original flags.

The web-chat agent sets `CLAUDE_MANAGER_AGENT=1` and `CLAUDE_MANAGER_SERVER_PID=<server pid>` in the child env. Before listening, `src/agent/cleanup.ts` scans `ps` for the marker and SIGTERMs leftover children — but only those reparented to launchd (ppid 1, i.e. their server died). The marker is inherited by agents' own subprocesses and is visible to other server instances, so the ppid check is what keeps a second instance (another port, a test run) from killing a live server's agents. Don't break that contract — it's how we avoid orphaned headless agents.

### Server layout

- `src/server.ts` — Fastify bootstrap, error/404 handling, static serving of `dist/`, scanner start, agent cleanup, graceful shutdown.
- `src/api/routes.ts` → `src/api/routes/*.ts` — split by resource: `sessions`, `agent` (SSE stream), `git`, `linear`, `keys`, `log`. New endpoints go in the appropriate file; register from `routes.ts`.
- `src/api/state.ts` — view layer that joins DB rows with live process/agent data and derives display state. Endpoints should call `viewAll`/`toView` rather than re-deriving state.
- `src/db.ts` — `better-sqlite3` with WAL. Schema is created idempotently in this file; `addColumnIfMissing` is the migration pattern (no separate migration files). Bumping `SCHEMA_VERSION` triggers `file_mtime` reset + FTS rebuild on next start.
- `src/log.ts` — JSONL log to `data/claude-manager.log` plus stdout/stderr mirror. Use `log(level, src, msg, extra?)` rather than `console.*` for anything you want persisted.

### Frontend layout

- `web/src/App.tsx` — bespoke path-based router (no react-router): `/`, `/sessions/:id`, `/linear`. Pushes via `navigate()` + popstate.
- `web/src/pages/{List,Detail,Linear}.tsx` — top-level pages. `Detail.tsx` opens an SSE connection to `/api/sessions/:id/stream` and drives the chat UI.
- `web/src/components/Composer.tsx` (~550 lines) is the heart of the chat input + approval flow. `bubble/` and `composer/` subfolders hold supporting components.
- `web/src/api.ts` — single typed client for the JSON API.
- Vite root is `web/`, output is `dist/` (one level up). `vite.config.ts` proxies `/api` to the server in dev.

## Configuration

All config is env-var driven (`src/config.ts`) — there is no config file. Keys: `CM_PORT`, `CM_PROJECTS_DIR`, `CM_DB_PATH`, `CM_LAUNCHER` (only `ghostty` is implemented), `CM_SCAN_INTERVAL_MS`, `CM_CLAUDE_BIN` (defaults to `~/.local/bin/claude`), `CM_AGENT_IDLE_TIMEOUT_MS`, `CM_LINEAR_API_KEY`, `CM_LOG_PATH`.

The Linear integration is optional and only enabled when an API key is configured; the `/linear` route is hidden when not configured.

## Platform notes

macOS-only paths are baked in: `/bin/ps`, `/usr/sbin/lsof`, `/usr/bin/open`, `Ghostty.app`. Don't generalize these to Linux without a real plan — the process scanner relies on `ps` etime + `lsof -Fn` output formats, and the launcher hard-codes `open -na Ghostty.app`.
