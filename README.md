# claude-manager

Local web app to manage Claude Code sessions across many repos.

## Quick start

```sh
pnpm install
pnpm dev    # builds the SPA, then runs the server at http://localhost:7777
```

For frontend hot-reload while editing the UI, run two terminals:

```sh
pnpm dev:server   # API + scanner on :7777
pnpm dev:web      # Vite dev server on :5173 (proxies /api → :7777)
```

Open `http://localhost:5173` in dev, `http://localhost:7777` in single-process mode.

## What it does

- Reads `~/.claude/projects/**/*.jsonl` to discover all your Claude Code sessions
- Tracks running `claude` processes via `ps` + `lsof` to know which sessions are live
- Stores user state (done flag, notes, custom titles) in a local SQLite DB at `data/claude-manager.db`
- Lets you launch new sessions in Ghostty windows or resume existing ones
- Surfaces a derived state per session: `working`, `waiting` (on you), `idle`, `stale`, `done`

## Configuration

Environment variables:

- `CM_PORT` (default `7777`)
- `CM_PROJECTS_DIR` (default `~/.claude/projects`)
- `CM_DB_PATH` (default `data/claude-manager.db`)
- `CM_LAUNCHER` (default `ghostty`)
- `CM_SCAN_INTERVAL_MS` (default `5000`)
