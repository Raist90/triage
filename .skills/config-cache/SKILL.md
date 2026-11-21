---
name: config-cache
description: Use when changing app settings, ~/.triage/config.json, tracked repos, repoPaths, Linear teams, token resolution, cache keys, TTLs, invalidation, or live refresh behavior. Covers internal/config and internal/cache.
---

# Configuration and caching

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
  "repoPaths": { "owner/name": "~/Projects/name" },
  "linear": { "teamKeys": ["ENG"] }
}
```

- Repos are `owner/name` strings, deduped case-insensitively. Malformed entries
  are dropped and named in `Config.Problem`; valid ones still load.
- `repoPaths` is the local clone each tracked repo needs for automatic review.
  Keys are `owner/name`, matched case-insensitively, and values expand `~`. A
  repo without a path is still tracked: only Review is disabled for it, and
  `GET /config` reports the reason (`No local path configured`,
  `Path does not exist`). A missing path is never a config error.
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
an `actions` list plus `actionsReason`, never the internals. See
`skill://claude-actions`.

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

## Caching

Rate limits are a product constraint. Cache aggressively, especially in dev.

- Cache key = stable hash of provider + query/route + variables.
- Store as JSON under `~/.triage/cache` with `{body, etag, fetchedAt}`.
- TTLs come from `internal/config`; GraphQL responses have no conditional
  requests, so TTL is the only freshness mechanism there.
- Live refresh is the one deliberate cache bypass. The visible PR list and the
  open PR re-read through `useLiveRefresh` (`src/lib/liveRefresh.ts`): 3 minutes
  while the window is focused, doubling up to 15 minutes while GitHub reports no
  change, and stopped on blur or a hidden window — including the list hidden by
  fullscreen, which stays mounted but does not poll. Leaving fullscreen, like a
  window regaining focus, reads once straight away. Those polls send `refresh`
  because a fresh answer is the point, not because the cache is slow.
- Per-entry and whole-cache invalidation must be reachable from the UI
  (`Settings → Refresh data`). Invalidation is a user action, not a debug hack.
- Claude artifacts live under `~/.triage/artifacts`; they are disposable and
  never contain tokens. Explain and Review share that tree: one file per SHA,
  action and prompt version. Review artifacts also record the worktree path,
  which is machine-local but never secret.
- In dev, long TTLs are correct behavior. Never bypass the cache to "make it
  faster" — fix the cache.
