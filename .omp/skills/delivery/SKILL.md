---
name: delivery
description: Use for any change that will be committed in this repo — creating a git worktree, a conventional branch (feat/fix/refactor/chore/perf/test), committing verified changes, pushing the branch, and opening a draft PR assigned to the user. Also use when asked to commit, push, open a PR, or update an existing PR.
---

# Delivery

Default flow for a code change in Triage. Act on the current checkout instead only
when the user asks, and say which mode you used.

## Preflight

- `git rev-parse --show-toplevel` → the primary checkout (`…/forge`), not a linked
  worktree, and never under `~/.triage/worktrees`.
- `git fetch origin main`, then `git rev-parse --short origin/main`.
- `gh auth status` and `gh repo view --json nameWithOwner -q .nameWithOwner`.
- Leave uncommitted changes in the primary checkout alone: they are the user's,
  not part of this change.

## 1. Worktree and branch

Name the branch `<type>/<2-5-word-kebab-slug>`; `type` is one of `feat`, `fix`,
`refactor`, `chore`, `perf`, `test`, matching the repository history. Put the
worktree beside the clone: `<parent-of-clone>/<repo>-<slug>`.

```sh
git worktree add -b "$BRANCH" "$WT" origin/main
cd "$WT" && bun install
```

Branch from `origin/main` unless the user asks to branch from the current HEAD.
Reuse an existing worktree only for the same branch and the same change; never
reuse a branch for a different change. A worktree has no `.env` and that is
expected — tests do not need tokens. Never copy it.

## 2. Work, then verify before committing

```sh
cd backend && go build ./... && go vet ./... && go test ./...   # Go
bun run fix && bun run typecheck && bun run test                # frontend
```

A Go type, route or response change means `make api`, and `openapi.json` plus
`src/lib/generated` go in the same commit. Never commit a change that fails
verification.

## 3. Commit

Use the harness commit tool; it stages only the lines you wrote. Use raw
`git add`/`git commit` only when the user asks or the tool is unavailable.

- Subject: `type(scope): imperative summary`, matching the repository history.
- Body: why the change exists, and the verification actually run.
- No attribution trailers, no `Generated with …`, no `(#NN)` suffix — GitHub adds
  the number on squash merge.
- One commit unless the user asks for a series. Never `git add -A` blindly.

## 4. Push and open the draft PR

```sh
git push -u origin "$BRANCH"
gh pr create --draft --assignee @me --base main \
  --title "<the commit subject>" \
  --body "## Summary
- …

## Verification
- bun run typecheck && bun run test
- cd backend && go build ./... && go vet ./... && go test ./..."
gh pr view --json number,url,isDraft,assignees
```

Report the PR number, URL, draft state and assignee. Do not mark it ready.

## Overrides

| The user says                                   | Do instead                                                  |
| ----------------------------------------------- | ----------------------------------------------------------- |
| "commit here", "on this branch", "add a commit" | Commit on the current checkout; no worktree, no push, no PR |
| "push only", "no PR yet", "don't open a PR"     | Stop after push; print the compare URL                      |
| "update the PR"                                 | Commit and push to the existing branch; no second PR        |
| "amend", "fixup"                                | Amend the existing commit; force-push only if also asked    |
| "no commit", "just show me"                     | Make no commit at all                                       |

## Stop conditions

- A PR already exists for the branch: report it, do not open a second.
- Push rejected: never force. Report and ask.
- `gh` missing or unauthenticated: push, print the compare URL, and say that the
  draft flag and assignee must be set by hand. Never fail silently.
- Never commit to `main`, never `--force`, never `stash`/`reset` the user's
  checkout, never touch `~/.triage/worktrees`.
- Removing a worktree after merge is the user's call: ask before
  `git worktree remove`.
