# Triage — Agent Guide

Triage is a macOS desktop app that makes GitHub pull-request review fast. It pulls
the PRs that matter (yours, ones awaiting your review, everything in the repos you
track), shows them in a keyboard-friendly Linear-style UI, and links each PR to
its Linear issue so you get context before reading a single line of diff.

The product is a **triage and review cockpit**, not a GitHub client. Every feature
must reduce the time between "I need to review this" and "review submitted".

This file is the index. Detailed conventions live in `.omp/skills/<name>/SKILL.md`
(omp: `skill://<name>`); read the owning skill before editing, and every listed
skill when a change spans directories. Hard, always-on rules are in
`.omp/RULES.md`.

## Stack

| Layer    | Choice                                                                      |
| -------- | --------------------------------------------------------------------------- |
| Shell    | Tauri 2 (thin Rust glue: window, spawn/kill Go sidecar, plugin permissions) |
| UI       | React 19 + TypeScript + Vite 8                                              |
| Styling  | Tailwind CSS 4 via `@tailwindcss/vite`, theme in `src/index.css`            |
| State    | TanStack Query (server state) + Zustand (UI state)                          |
| Backend  | Go sidecar, HTTP on `127.0.0.1`                                             |
| GitHub   | GraphQL for metadata/reviews, REST for diffs and file lists                 |
| Linear   | GraphQL                                                                     |
| Semantic | `sem` CLI (Rust), shelled out from Go                                       |

Package manager and script runner: **Bun**. Rust is only used for Tauri glue.

## Architecture

```
React (webview)
   │  HTTP + bearer handshake token
   ▼
Go sidecar  ──►  GitHub GraphQL / REST
            ──►  Linear GraphQL
            ──►  ~/.triage/cache (JSON)
            ──►  sem CLI (stdin/stdout)
```

- The Go server binds `127.0.0.1` on a **random port**, prints `{"port":N,"token":"..."}`
  as a single line to stdout on startup, and requires `Authorization: Bearer <token>`
  on every request. Tauri reads the handshake, forwards it to the webview, and kills
  the process on exit.
- No secrets ever reach the webview. Tokens live in the Go process only.
- All GitHub/Linear traffic goes through the Go server. The frontend never calls
  `api.github.com` or `api.linear.app` directly.
- In dev the Go server runs as a normal process next to Vite. In production it is
  bundled as a Tauri `externalBin` sidecar.

## Repository layout

| Path                                                              | Owns                                                           | Rules                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------- |
| `src/`                                                            | React app: shell, panes, features, stores, test helpers        | `frontend`                |
| `src/lib/api.ts`                                                  | the only fetch layer                                           | `frontend`                |
| `src/lib/types.ts`                                                | app-facing facade over the generated types                     | `frontend`                |
| `src/lib/generated/`                                              | OpenAPI-generated contract, never hand-edited                  | `backend`                 |
| `backend/cmd/triage-server/`                                      | config, tokens, handshake, HTTP server                         | `backend`, `config-cache` |
| `backend/internal/api/`                                           | Huma routes, request/response types, error envelope, SSE route | `backend`                 |
| `backend/internal/gql/`, `github/`, `linear/`, `diff/`, `plugin/` | providers and domain logic                                     | `backend`                 |
| `backend/internal/config/`, `cache/`                              | settings, tokens, TTLs, invalidation                           | `config-cache`            |
| `backend/internal/actions/`, `review/`, `worktree/`               | Explain/Review, SSE, artifacts, review worktrees               | `claude-actions`          |
| `src-tauri/`                                                      | Tauri shell, plugin permissions                                | — (thin glue)             |
| `openapi.json`                                                    | generated from the Go routes; committed                        | `backend`                 |

Runtime state lives outside the repo: `~/.triage/config.json` (settings),
`~/.triage/cache` (provider responses), `~/.triage/artifacts` (Explain and Review
answers), `~/.triage/worktrees` (app-owned review checkouts).

## Commands

Day-to-day, use the Makefile from the repo root:

| Command           | Does                                             |
| ----------------- | ------------------------------------------------ |
| `make dev`        | backend + frontend (browser), Ctrl-C stops both  |
| `make app`        | backend + Tauri desktop shell, Ctrl-C stops both |
| `make backend`    | Go sidecar only                                  |
| `make frontend`   | Vite only                                        |
| `make check`      | typecheck + lint + go build/vet + verify-api     |
| `make test`       | frontend + Go tests                              |
| `make api`        | regenerate `openapi.json` + `src/lib/generated`  |
| `make verify-api` | fail when the committed contract is stale        |
| `make fix`        | ESLint --fix + Prettier write                    |
| `make build`      | frontend bundle + Go binary                      |
| `make clean`      | remove build artifacts and dev handshake         |
| `make help`       | list targets                                     |

Raw commands, for debugging one side or when make is not available:

```sh
bun install                 # dependencies
bun run tauri dev           # desktop app (also needs the Go server)
bun run dev                 # frontend only, browser
bun run backend:dev         # run the Go sidecar on its own
bun run typecheck           # tsc --noEmit
bun run test                # frontend tests (Bun + happy-dom)
bun test --watch src        # frontend tests in watch mode
bun run lint                # ESLint + Prettier check
bun run fix                 # ESLint --fix + Prettier write
cd backend && go build ./... && go vet ./...
cd backend && go test ./...
```

- Prefer `make dev` / `make app`; they start and stop both processes together.
- After frontend changes run `bun run fix`, `bun run typecheck`, `bun run test`;
  after Go changes run `go build ./... && go vet ./... && go test ./...`.
- After any change to a request or response type, run `make api` and commit
  `openapi.json` plus `src/lib/generated`.

## Non-negotiables

- `src/lib/generated` is generated. Change the Go type, run `make api`, commit
  both files. Never edit it by hand.
- Bun only. Never add a package without a reason; prefer stdlib and hand-rolled
  code.
- Never read, print or commit `.env`; tokens are the user's. Commit only
  `.env.example`.
- Never bypass the cache to "make it faster" in dev; fix the cache.

## MVP scope

In:

- GitHub auth via `.env`, identity via `viewer`
- Sidebar repo selection; tabs My PRs / Review requested / All open
- PR list with title, author, repo, branch, checks/status, review state
- PR detail: metadata, description, per-file diff (`sem` where possible), comments
  behind a global toggle
- Post a review: approve, request changes, comment
- Toggle your own PRs between draft and ready for review; squash merge your own
  PRs once GitHub reports them mergeable; close your own open PRs without
  merging behind a confirmation bar. The list refreshes after a short delay.
- Inline diff comments on any open PR, including your own; comments anchor to
  the current head commit, and you can delete your own
- Automatic review: a structured, on-demand review of the PR head in a
  disposable worktree, with anchored findings, jump to the diff, and patches
  that apply to the worktree only
- Linear link + issue metadata panel (read-only)
- Settings: tracked repos, cache invalidation, clear artifacts, clear worktrees
- Aggressive caching

Out (do not build yet):

- Notifications, multi-account, GitHub OAuth/device flow
- Real-time updates/webhooks; polling anything beyond the visible list and the
  open PR
- Publishing review comments or findings to GitHub
- Comment thread replies, resolve, suggestion commits
- Reopen a closed PR, merge methods other than squash, auto-merge, checkout locally
- Side-by-side diff, diff modes beyond per-file unified
- Inline annotations inside the Diff tab; Review jumps first, annotation later
- Managed clones; review uses the configured `repoPaths` only
- External/first-party plugin loading, a plugin marketplace
- Command palette, themes, light mode

## Working agreements

- Keep it minimal. When choosing between "flexible" and "small", choose small.
- Build the narrow vertical slice (repo → list → detail → review) before
  polishing anything.
- Prefer deleting a placeholder over implementing it speculatively.
- No new dependency, abstraction, or config layer without a concrete need.
- Remove the demo `greet` command and example view once real views exist.
- One owner per rule. Update the owning `.omp/skills/<name>/SKILL.md` when a rule
  changes; this hub only routes.
- `.omp/RULES.md` intentionally repeats the handful of rules that must survive
  compaction and reach subagents; keep it short and in sync.
