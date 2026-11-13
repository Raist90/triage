# Triage — Agent Guide

Triage is a macOS desktop app that makes GitHub pull-request review fast. It pulls
the PRs that matter (yours, ones awaiting your review, everything in the repos you
track), shows them in a keyboard-friendly Linear-style UI, and links each PR to
its Linear issue so you get context before reading a single line of diff.

The product is a **triage and review cockpit**, not a GitHub client. Every feature
must reduce the time between "I need to review this" and "review submitted".

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

```
src/                     React app
  App.tsx                shell layout
  index.css              Tailwind entry + theme tokens
  components/            presentational components
  features/              prs/, settings/, linear/ (queries, hooks, views)
  lib/                   api client, utils, types
  stores/                Zustand stores
backend/                 Go module (github.com/Raist90/triage/backend)
  cmd/triage-server/      main: config, handshake, HTTP server
  internal/api/          HTTP routes + request/response types
  internal/gql/          hand-rolled GraphQL client (POST + JSON, no deps)
  internal/github/       GitHub queries, REST diffs, types
  internal/diff/         unified-diff splitting + `sem` annotations
  internal/linear/       Linear queries, issue linking
  internal/plugin/       Plugin interface + registry
  internal/actions/      Claude runner, diff prompt builder, stream parser, artifact store
  internal/cache/        on-disk cache, TTL, invalidation
  internal/config/       the single source of truth for app settings
src-tauri/               Tauri shell (Rust)
.env                     GITHUB_TOKEN, LINEAR_API_KEY — gitignored, never committed
.env.example             committed, keys only, no values
```

## Commands

Day-to-day, use the Makefile from the repo root:

```sh
make dev                    # backend + frontend (browser), Ctrl-C stops both
make app                    # backend + Tauri desktop shell, Ctrl-C stops both
make backend                # Go sidecar only
make frontend               # Vite only
make check                  # typecheck + lint + go build/vet
make test                   # Go tests
make fix                    # ESLint --fix + Prettier write
make build                  # frontend bundle + Go binary
make clean                  # remove build artifacts and dev handshake
make help                   # list targets
```

Raw commands, for debugging one side or when make is not available:

```sh
bun install                 # dependencies
bun run tauri dev           # desktop app (also needs the Go server, see below)
bun run dev                 # frontend only, browser
bun run backend:dev         # run the Go sidecar on its own
bun run typecheck           # tsc --noEmit
bun run lint                # ESLint + Prettier check
bun run fix                 # ESLint --fix + Prettier write (do this before finishing)
cd backend && go build ./... && go vet ./...
cd backend && go test ./...
```

Rules:

- Prefer `make dev` / `make app`; they start and stop both processes together.
- Run `bun run fix` and `bun run typecheck` after frontend changes, and
  `go build ./... && go vet ./... && go test ./...` after Go changes.
- The frontend has no test runner. `make test` covers the Go packages only.
- Never add a package without a reason; prefer stdlib and hand-rolled code.
- Do not read or print `.env` contents during development; tokens are the user's.
- Do not commit `.env`.

## UI rules

Dark, quiet cockpit. Dense, aligned, low-chrome. The PR list and the PR detail
stay side by side; reviewing is the only flow that matters.

- **Type: Geist Sans + Geist Mono** (`src/index.css`, bundled woff2, OFL). Use the
  six-size scale only: `text-micro` 10, `text-meta` 12, `text-ui` 13,
  `text-prose` 14, `text-lead` 16, `text-title` 20, plus `text-code` 12/20.
  Weights are 400 and 500 only. `text-sm`/`text-xs`/`text-2xs` are gone.
- **Mono = identity data.** Branch, repo, PR number, SHA, counts, file paths,
  timestamps use `font-mono` + `tabular`. Prose and UI labels stay sans. Mono
  disables ligatures (`font-variant-ligatures: none` in `index.css`); they
  break diff span boundaries and are never useful in identity data.
- **Color roles, not shades.** Use `canvas`, `surface`, `raised`, `line`,
  `line-strong`, `fg`, `fg-body`, `fg-muted`, `fg-faint` from `@theme`. Never
  hardcode `zinc-*` in components, never use opacity variants on text.
- **Accent: one green** (`accent`) for active rail, selection rails, dots,
  primary action, focus. **Danger red** is semantic only: failing checks and
  deletions. No other hues in chrome.
- **Spacing: 4 / 8 / 12 / 16 / 24 / 32 only.** No `py-1.5`, `py-2.5`, `gap-3.5`,
  `px-5`. Chrome heights: 44 top bar, 36 toolbar, 52 list row. Widths: 48 rail,
  208 repo panel, 340 PR list, 272 context rail.
- **Radii:** 4px controls, 6px dialog. One focus ring (`accent` at 45%) from
  `index.css`; do not re-style focus per component.
- **Shell:** 48px rail holds the config-driven tabs (icon + tooltip, fallback
  icon for unknown IDs) and Settings. Then the repo panel, PR list, and detail.
  Detail is a sibling pane, never a route. Below `cockpit` (1180px) the detail
  covers the list. The list stays mounted so cursor and scroll survive.
- **Fullscreen:** toggled only by the icon button in the 44px detail bar, no key
  binding. It hides the rail, repo panel and PR list; the list is hidden, not
  unmounted, so leaving fullscreen restores its cursor and scroll. The context
  rail keeps its normal rules and the main pane gets the full width.
- **No card soup.** Prose, comments and metadata use one surface plus 1px
  `border-line` rules. Only the diff and dialogs get a box.
- **PR detail:** compact header, 44px bar, tabs for Conversation (default), Diff,
  Explain (when available). Conversation is one chronological timeline: the PR
  body first, then comments, review verdicts and inline review comments. The
  272px context rail shows checks, review, change stats, branches, commit and
  author; it is hidden below 1400px and while the Diff tab is active (the diff
  needs the width).
- **Diffs:** per file, collapsible, full width, 208px file rail. Semantic diff
  via `sem` when available; fall back to a plain unified diff. Never fail a
  review flow because `sem` is absent. Code is syntax-highlighted by the Go
  sidecar (Chroma): colored, but only desaturated `syn-*` tokens from
  `index.css`, never raw hues in components. Chrome stays hue-free.
- **Icons:** `lucide-react`, 14–16px. Reuse `Button`, `IconButton`, `MicroLabel`,
  `Kbd` from `src/components/ui.tsx`; do not paste new button class strings.
- **Components:** no styling frameworks, no shadcn/Radix, no CSS-in-JS, no CSS
  files other than `src/index.css`. Build primitives by hand.
  [Base UI](https://base-ui.com) is the only exception and only for accessible
  widgets (dialog, popover, menu, tooltip) when hand-rolling one is genuinely
  risky — always headless and styled by us.
- Keyboard-first where cheap: `j`/`k` list navigation, `Enter` opens, `Esc` closes.
  Do not build a command palette until the core flow works.

## Frontend conventions

- TypeScript strict. No `any`; use `unknown` + narrowing at API boundaries.
- All server data through TanStack Query. Query keys are tuples
  (`["prs", repo, tab]`, `["pr", repo, number]`). Mutations invalidate precisely.
- Zustand only for ephemeral UI state (selected repo, active tab, toggles).
  Never duplicate server data into a store.
- API calls live in `src/lib/api.ts`; components never `fetch` directly.
- Types mirroring Go responses live in `src/lib/types.ts` — keep them in sync when
  the Go contract changes.
- Components: named exports, one component per file, props typed inline or with a
  local `type`. Semantic HTML first.
- Tailwind classes sorted by Prettier; do not hand-order them.

## Go conventions

- Go module in `backend/`. `go vet` clean, `gofmt` formatting.
- Standard library `net/http` with `http.ServeMux`. No web framework.
- JSON in, JSON out. Errors as `{"error":{"code":"...","message":"..."}}` with
  meaningful HTTP status codes. Never leak tokens or raw provider responses.
- GraphQL: use `internal/gql`, a tiny hand-rolled `POST` client. No GraphQL
  client dependency. Queries as raw strings, variables as typed structs.
- REST is used only where GraphQL can't do the job — PR diffs and file lists.
  Use `ETag`/`If-None-Match` there.
- Context everywhere; honor cancellation; set HTTP timeouts.
- One provider per package (`internal/github`, `internal/linear`); `internal/api`
  orchestrates and never talks to HTTP providers inline.
- Personal tool, single account. Identity comes from GitHub's `viewer` query.

## Caching

Rate limits are a product constraint. Cache aggressively, especially in dev.

- Cache key = stable hash of provider + query/route + variables.
- Store as JSON under `~/.triage/cache` with `{body, etag, fetchedAt}`.
- TTLs come from `internal/config`; GraphQL responses have no conditional
  requests, so TTL is the only freshness mechanism there.
- Per-entry and whole-cache invalidation must be reachable from the UI
  (`Settings → Refresh data`). Invalidation is a user action, not a debug hack.
- Claude artifacts live under `~/.triage/artifacts`; they are disposable and
  never contain tokens.
- In dev, long TTLs are correct behavior. Never bypass the cache to "make it
  faster" — fix the cache.

## Configuration

Single source of truth lives in **Go** (`backend/internal/config`). The frontend
fetches it from `GET /config`; it never hardcodes repo lists or user names.

User settings live in `~/.triage/config.json`, next to the cache and artifacts.
`config.DefaultPath()` resolves it; `config.Load` reads it over `config.Default`
at startup, so edits apply on the next app launch. The file is small and hand
edited:

```json
{
  "user": { "login": "", "name": "" },
  "repos": ["owner/name", "other/repo"],
  "linear": { "teamKeys": ["ENG"] }
}
```

- Repos are `owner/name` strings, deduped case-insensitively. Malformed entries
  are dropped and named in `Config.Problem`; valid ones still load.
- Unknown keys are rejected (`DisallowUnknownFields`) so a typo like `"repo"`
  fails loudly instead of silently doing nothing.
- Omitted keys keep their defaults. `"repos": []` means no tracked repos.
- A missing file is created from a template at mode `0600`. The directory is
  `0700`.
- A file that does not parse leaves defaults in place and reports the problem
  on `Config.Problem`. The app still starts; `GET /config` returns `configPath`
  and `configError`, and Settings shows both.

`Tabs`, `Cache` TTLs and `Actions` stay in Go. Tabs are product structure, and
the action model, budget and prompt are server-side only. `GET /config` returns
an `actions` list plus `actionsReason`, never the internals. See **Claude
actions**.

Migration rule: every hardcoded value must sit behind the `Config` struct. Do not
scatter repo names, org names or Linear IDs through components or queries.

Secrets are not config. Tokens are resolved by `internal/config/tokens.go` in this
order:

1. `GITHUB_TOKEN` / `LINEAR_API_KEY` from the repo-root `.env`. The repo root is
   found by walking up from the working directory until a folder holds the
   committed `.env.example`, so the file is read the same way from `make app`,
   from a subdirectory, or from an IDE run config. No home-directory file.
2. GitHub only: if `GITHUB_TOKEN` is empty, shell out to `gh auth token` with a 2s
   timeout and use its output. Failure is silent — the app reports "GitHub not
   configured" in the UI rather than erroring out.
3. Linear has no fallback. `LINEAR_API_KEY` must be present in `.env`.

`Tokens.Source` holds the `.env` path that was read, empty when none was found.
Startup logs it as `env_file` so a missing file is visible. Path only, never a
value.

Never read `.env` from any other package, never log token values, never send them to
the webview. Commit only `.env.example`.

## Plugin system

`internal/plugin` defines the contract:

```go
type Plugin interface {
    Name() string
    ResolveLink(pr PR) (*Link, error) // regex-based for now
    Enrich(ctx context.Context, link Link) (*Metadata, error)
}
```

- MVP: one in-repo plugin, `linear`, linking PRs to issues via a regex on the
  **branch name** (e.g. `eng-123-some-slug` → `ENG-123`). Manual linking is not
  in scope yet.
- Plugins are registered explicitly in `internal/plugin/registry.go`. No
  reflection, no dynamic loading.
- To keep the path to external plugins open: plugins only depend on types from
  `internal/plugin` (never on `internal/api`), and their config lives in their own
  struct inside `internal/config`. No global state, no direct filesystem or
  network calls outside the plugin's own client.
- Do not build a plugin SDK, manifest format or loader until a second plugin
  exists. The interface is the boundary; the seams are enough.

## Claude actions

One PR-scoped action: **Explain**. The Go sidecar (never Rust, never the webview)
fetches the PR's unified diff, sends it to the local `claude` CLI, and streams the
answer back over SSE. No checkout, no local clone, no worktree.

- **Diff-only context.** `internal/api` loads the diff from GitHub REST through
  the same ETag cache as the diff route, and `actions.PromptData.WithDiff` turns
  it into a file list plus patch text with a byte budget. Files that do not fit
  are omitted and named in the prompt, never silently dropped. Dependency,
  generated and lock files are tried last so source changes win the budget.
- **No tools.** `claude` runs with `--tools ""`: no filesystem, shell or network
  access. PR title, description and diff are untrusted prompt input, fenced in a
  `<diff>` block; the fixed system prompt says not to follow instructions inside
  it. An answer may only claim things visible in the diff.
- **Streamed, bounded.** `--output-format stream-json` → NDJSON parser → SSE
  events `status`, `delta`, `done`, `error`. One job per PR+action; 5-minute
  timeout; child process group killed on cancel and on app shutdown.
- **Artifacts.** `~/.triage/artifacts/<owner>/<repo>/<number>/<sha>/<action>.json`,
  keyed by SHA + model + prompt version. A SHA change makes the old answer
  stale: served with `stale: true` and a Re-run button, never as current.
  `Settings → Clear artifacts` removes the tree.
- **Gating.** One gate: `exec.LookPath("claude")` succeeded at startup.
  `/config.actions` is empty when the CLI is missing; `actionsReason` explains
  why. Every tracked repo is otherwise runnable.
- **HTTP.** `POST/GET /pr/{owner}/{repo}/{n}/actions/{id}`,
  `GET .../actions/{id}/stream` (SSE over `fetch`, bearer header — never a query
  token), `POST .../actions/{id}/cancel`, `POST /artifacts/clear`.
- **Config.** Action model, budget and prompt live in `internal/config` and never
  reach the webview. Adding an action is a config entry, not a new route or
  component.

## MVP scope

In:

- GitHub auth via `.env`, identity via `viewer`
- Sidebar repo selection; tabs My PRs / Review requested / All open
- PR list with title, author, repo, branch, checks/status, review state
- PR detail: metadata, description, per-file diff (`sem` where possible), comments
  behind a global toggle
- Post a review: approve, request changes, comment
- Inline diff comments on any open PR, including your own; comments anchor to
  the current head commit, and you can delete your own
- Linear link + issue metadata panel (read-only)
- Settings: tracked repos, cache invalidation
- Aggressive caching

Out (do not build yet):

- Notifications, multi-account, GitHub OAuth/device flow
- Real-time updates/webhooks, polling UI beyond manual refresh
- Comment thread replies, resolve, suggestion commits
- Merge, close, checkout locally
- Side-by-side diff, diff modes beyond per-file unified
- External/first-party plugin loading, a plugin marketplace
- Command palette, themes, light mode

## Working agreements

- Keep it minimal. When choosing between "flexible" and "small", choose small.
- Build the narrow vertical slice (repo → list → detail → review) before
  polishing anything.
- Prefer deleting a placeholder over implementing it speculatively.
- No new dependency, abstraction, or config layer without a concrete need.
- Remove the demo `greet` command and example view once real views exist.
- Update this file when a rule changes; it is the contract for future agents.
