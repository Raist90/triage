# Triage — hard rules

Carried on every request, including to subagents, which never receive `AGENTS.md`.
Keep this file short: rules that are destructive when missed, not background.

- Never hand-edit `src/lib/generated`. Change the Go type, run `make api`, commit
  `openapi.json` and `src/lib/generated` with the change.
- Bun only: no npm/yarn, no new dependency without a reason.
- Never read, print or commit `.env`; tokens stay in the Go process.
- After Go changes: `cd backend && go build ./... && go vet ./... && go test ./...`.
- After frontend changes: `bun run fix && bun run typecheck && bun run test`.
- Never bypass the cache to look faster; fix the cache.
