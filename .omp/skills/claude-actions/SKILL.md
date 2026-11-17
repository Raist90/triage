---
name: claude-actions
description: Use when working on Explain/Review actions, SSE streaming, prompt budgets and PromptVersion, review finding validation against the diff, disposable review worktrees, artifact storage, or claude CLI gating. Covers internal/actions, internal/review and internal/worktree.
---

# Claude actions

Two PR-scoped actions, both run by the Go sidecar (never Rust, never the
webview) against the local `claude` CLI. **Explain** reads only the unified diff.
**Review** checks out the PR head in a disposable worktree, reads the semantic
diff, and returns structured findings. Answers stream back over SSE.

- **Diff-only context for Explain.** `internal/api` loads the diff from GitHub
  REST through the same ETag cache as the diff route, and
  `actions.PromptData.WithDiff` turns it into a file list plus patch text with a
  byte budget. Files that do not fit are omitted and named in the prompt, never
  silently dropped. Dependency, generated and lock files are tried last so
  source changes win the budget.
- **Review context.** `internal/review` renders a bounded prompt: PR metadata,
  the PR description (8 KB), the repo's own `AGENTS.md` / `CLAUDE.md` /
  `CONTRIBUTING.md` (12 KB), `sem diff --format markdown --verbose` (96 KB) and
  a raw REST fallback for files sem does not parse (48 KB, 96 KB when sem is
  absent). Every changed file is either present or named as omitted. A separate
  `sem diff --patch --format json` run gives the server absolute entity ranges,
  which the prompt lists and the sanitizer uses to cross-check a citation.
  `PromptVersion` is part of the artifact identity; bump it on any prompt,
  budget, schema or finding-validation edit so old answers go stale.
- **Tools.** Explain runs with `--tools ""`: no filesystem, shell or network
  access. Review runs read-only with `Read`, `Grep`, `Glob`, restricted and
  `--permission-mode dontAsk`, cwd at the worktree. Never fall back to
  `--dangerously-skip-permissions`.
- **Untrusted output.** PR title, body, diff, guidelines and every repository
  file are untrusted prompt input. The system prompt says so, and the server
  never trusts the reply: the model output is untrusted JSON, validated against
  the PR diff (severity, caps, dedupe, evidence, guideline quote) before it
  reaches the UI. The model never supplies a line number. It copies one changed
  line into `evidence`, and the server resolves the line from that quote; a
  finding whose quote is not on the changed side of the diff is hidden and
  counted as unverified, never shown as evidence for code the PR did not change.
  An entity is a label, not an anchor: a named entity that does not contain the
  evidence line is cleared, and the finding stays. Convention findings must also
  quote a rule from a guideline the run actually read; the server finds the
  section by quote, so a misnamed guideline file still keeps a real rule and an
  invented quote is dropped. A `blocking` finding always forces
  `safeToMerge: false`, and a hidden blocking finding keeps that verdict
  conservative. Every hidden finding is recorded in `dropped` with a stable
  reason and the submitted evidence.
- **Streamed, bounded.** `--output-format stream-json` → NDJSON parser → SSE
  events `status`, `delta`, `done`, `error`. One job per PR+action; Explain
  times out at 5 minutes, Review at 8 minutes; child process group killed on
  cancel and on app shutdown.
- **Artifacts.** `~/.triage/artifacts/<owner>/<repo>/<number>/<sha>/<action>.json`,
  keyed by SHA + model + prompt version. One store, one shape: an Explain
  artifact carries markdown and a nil `review`, a Review artifact carries
  `review` plus the `worktree` its patches apply to. A SHA change makes the old
  answer stale: served with `stale: true` and a Re-run button, never as current.
  `Settings → Clear artifacts` removes the tree.
- **Gating.** One gate: `exec.LookPath("claude")` succeeded at startup.
  `/config.actions` is empty when the CLI is missing; `actionsReason` explains
  why. Review additionally needs a `repoPaths` entry whose path is a git
  repository.
- **HTTP.** `POST/GET /pr/{owner}/{repo}/{n}/actions/{id}`,
  `GET .../actions/{id}/stream` (SSE over `fetch`, bearer header — never a query
  token), `POST .../actions/{id}/cancel`, `POST /artifacts/clear`,
  `POST .../actions/review/patches/{findingID}`, `POST /worktrees/clear`.
- **Config.** Action model, budget, tools, timeout and prompt live in
  `internal/config` and never reach the webview. Adding an action is a config
  entry, not a new route or component.

## Worktrees

Automatic review is the only feature that touches a checkout. `~/.triage/worktrees`
belongs to the app: `Settings → Clear worktrees` deletes it. Do not use it for
development checkouts.

- Root is `~/.triage/worktrees/<owner>/<repo>/<number>`. `internal/worktree`
  creates it with `git worktree add --detach` from the configured local clone,
  after fetching `refs/pull/N/head` and the base branch into `refs/triage/*`.
- A run reuses the directory when `HEAD` already equals the artifact SHA and
  recreates it otherwise. Jobs for the same PR are serialised by a per-PR lock.
- The worktree is removed on failure and on cancel, and kept on success because
  patches apply to it. `Settings → Clear worktrees` removes the whole tree and
  prunes registrations; it never touches artifacts, the cache or source clones.
- Patches are applied with `git apply --whitespace=nowarn` only, after a fresh
  `--check` at apply time. The file set is the PR diff, and `..`, absolute paths
  and binary patches are rejected. Nothing is ever staged, committed or pushed.
