# Triage

macOS desktop app for GitHub pull request review. It collects the PRs you own,
the ones awaiting your review, and everything open in the repos you track, then
opens a diff view with inline comments.

## Stack

- **Tauri 2** (Rust): window shell and process supervision
- **React 19 + TypeScript**: UI (`src/`)
- **Vite 8**: dev server and bundler
- **Tailwind CSS 4**: via `@tailwindcss/vite`, theme in `src/index.css`
- **Go**: local sidecar (`backend/`), the only process that talks to GitHub and
  Linear
- **TanStack Query + Zustand**: server state and UI state
- **Bun**: package manager and script runner

## Requirements

macOS 10.15+, Xcode Command Line Tools, Rust stable, Go 1.25+, Bun ≥ 1.3.

```sh
xcode-select --install
curl -fsSL https://bun.sh/install | bash
```

Two optional CLIs:

- `sem` adds semantic diff annotations. Without it the app falls back to a plain
  unified diff.
- `claude` enables the Explain action. Without it the PR tab has no AI panel.

## Setup

1. Install dependencies.

   ```sh
   bun install
   ```

2. Create the token file. Copy the keys from `.env.example`, then fill them in.

   ```sh
   cp .env.example .env
   ```

   The Go sidecar reads `.env` from the repo root, found by walking up from
   wherever the process starts, so `make app` and `make dev` both see it. The
   file is gitignored; only `.env.example` is committed.

   `GITHUB_TOKEN` can stay empty if `gh` is installed and authenticated, since
   the Go sidecar falls back to `gh auth token`. Linear has no fallback, so
   `LINEAR_API_KEY` must be set or the Linear panel stays empty.

3. Start the app.

   ```sh
   make app
   ```

4. Add your repositories. The first launch creates `~/.triage/config.json`.
   Edit it and restart the app:

   ```json
   {
     "user": { "login": "", "name": "" },
     "repos": ["owner/name", "another/repo"],
     "linear": { "teamKeys": ["ENG"] }
   }
   ```

   Settings shows the path and any parse error. Invalid entries are dropped and
   reported there instead of stopping the app.

## Commands

Run them from the repo root with `make`:

| Command      | What it does                                      |
| ------------ | ------------------------------------------------- |
| `make app`   | Go sidecar + Tauri desktop shell                  |
| `make dev`   | Go sidecar + Vite in a browser                    |
| `make check` | typecheck, lint, `go build`, `go vet`             |
| `make test`  | Go tests                                          |
| `make fix`   | ESLint `--fix` and Prettier write                 |
| `make build` | frontend bundle and Go binary                     |
| `make clean` | remove build artifacts and the dev handshake file |

Raw scripts, for debugging one side:

```sh
bun run tauri dev     # desktop shell, needs the Go server running
bun run dev           # Vite only
bun run backend:dev   # Go sidecar only
bun run typecheck
bun run lint
```

Go checks:

```sh
cd backend && go build ./... && go vet ./... && go test ./...
```

## Layout

```
src/                  React app
  components/         presentational components
  features/prs/       PR list, detail, diff, review flows
  lib/                api client, types, utils
  stores/             Zustand UI state
backend/              Go module
  cmd/triage-server/  entrypoint, handshake, HTTP server
  internal/api/       routes and response types
  internal/github/    GitHub GraphQL and REST
  internal/diff/      diff parsing, highlighting, sem annotations
  internal/actions/   Explain action, prompt, artifacts
  internal/config/    config file, defaults, tokens
  internal/cache/     on-disk response cache
src-tauri/            Tauri shell
```

The Go sidecar binds `127.0.0.1` on a random port and prints one handshake line
(`{"port":...,"token":...}`) on stdout. Every request needs that bearer token.
Tokens stay in the Go process and never reach the webview.

## Plugins

Only `@tauri-apps/plugin-opener` is installed. Add more with:

```sh
bun add @tauri-apps/plugin-store
cd src-tauri && cargo add tauri-plugin-store
```

Then register the Rust plugin in `src-tauri/src/lib.rs` and allow its
permissions in `src-tauri/capabilities/default.json`.
