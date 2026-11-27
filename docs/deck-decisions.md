# Deck — resolved decisions

Status: implementation contract. Dated 2026-11-26.

> **Amendment 2026-11-27 — the hero is dropped.** The deck is grouping plus
> rows only: no hero, no draft fallback, no Skip, no extra options above the
> buckets. The elected row stays in its bucket, bucket counts include every
> filtered row, and the first row of the first bucket is the only “up next”
> affordance. This supersedes D2, D7's hero content, the Skip decision, and
> every other hero reference below; those sections stay as history. See
> `mock/hero-directions.html` option 01 for the shipped composition.

Open-PR detail navigation ships as the briefing in
`docs/pr-detail-briefing.md`, which supersedes the tab model. D9/D10 below
describe the shipped briefing and places.

This file resolves every open item in `docs/deck-implementation.md`. Read it
with that file and `mock/ui-directions.html`:

1. This file wins over `docs/deck-implementation.md`.
2. This file wins over the mock wherever the mock shows a state or composition
   that this file excludes.
3. The mock remains the source for geometry, colour recipes, type scale, hover,
   press, focus, selection and reduced-motion behaviour.

The Deck ships as one vertical slice: list grouping + hero + preflight. Nothing
else in the mock is required by this contract.

## Scope

In:

- My PRs / Review requested / All open tabs, grouped and ordered.
- One hero per list: **Up next** on My PRs, **Needs you** on the other tabs.
- A preflight tab for open PRs, opened by default from the Deck.
- The list, hero and preflight data additions listed under “Contract changes”.
- Keyboard navigation, collapse, filters, skip, empty/loading/error reuse.

Out, explicitly:

- Linear, issue links, Linear metadata, any disabled `Link issue` placeholder.
- Review minutes/duration estimates.
- Inline annotations in the preflight.
- A “more” row, a footer count that differs from the header, or bucket
  truncation.
- New colours, new type sizes, new z-index layers, or a second detail bar.

## Decisions

### D1. Tabs and bucket sets

Bucket sets are tab-specific. Empty buckets are not rendered.

| Tab      | Buckets, in visual order                                                          | Hero                    |
| -------- | --------------------------------------------------------------------------------- | ----------------------- |
| `mine`   | **Blocked on you**, **Ready to merge**, **Waiting on reviewers**, **Your drafts** | Up next, draft fallback |
| `review` | **Needs your review**, **Drafts**                                                 | Needs you               |
| `all`    | **Needs you**, **Your PRs**, **Waiting on author**, **Drafts**                    | Needs you               |

Predicates:

```ts
failing  = checkStatus === "failure" || checkStatus === "error";
pending  = checkStatus === "pending" || checkStatus === "expected";
blocked  = reviewState === "changes_requested" || failing;
viewer   = current viewer login from the list response;
isMine   = author === viewer;             // compare logins case-insensitively

// draft overrides every other assignment, in every tab
if (isDraft) -> Drafts

// mine
blocked      -> Blocked on you
ready        = !blocked && reviewState === "approved" && (checkStatus === "success" || checkStatus === "none")
ready        -> Ready to merge
everything else -> Waiting on reviewers

// review
everything non-draft -> Needs your review

// all
needsYou = (isMine && blocked) || reviewRequested
needsYou -> Needs you
isMine && !needsYou -> Your PRs
everything else non-draft -> Waiting on author
```

`reviewRequested` is a new list field: true when the viewer is a requested user
reviewer. Team requests are not detected; on the `review` tab that is harmless
because GitHub search already scoped the list, and on `all` a team-requested PR
falls into **Waiting on author**. Accept that limitation for v1.

**Ready to merge** is state-based: the list does not fetch `mergeable`, so a
conflicting approved PR can appear in that bucket. The preflight/detail remains
the truth for mergeability; do not add a list query for it.

The `review` tab intentionally has no “Waiting on author”: submitting your
review removes the PR from `review-requested:@me`.

### D2. Row order and hero election

One comparator defines “the list's current order”; the hero is the first
eligible row in that order.

```ts
bucketRank = mine:  blocked 0, ready 1, waiting 2, drafts 3
             review: review 0, drafts 1
             all:    needs 0, yours 1, waiting 2, drafts 3

severityRank = blocked 0, warn 1, wait 2

rowOrder = bucketRank asc
         -> severityRank asc
         -> updatedAt desc
         -> repo asc
         -> number asc

draftsOrder = updatedAt desc -> repo asc -> number asc
```

Severity:

```ts
blocked = reviewState === "changes_requested" || failing;
warn = !blocked && (reviewState === "review_required" || pending);
wait = otherwise;
```

Draft rows have no severity. `Ready to merge` rows are `wait`.

Hero election, every tab:

- Eligible = row can carry that tab's hero: in `mine` every row (non-drafts
  first, drafts as the fallback); in `review` every non-draft; in `all` every
  non-draft whose bucket is **Needs you**. Eligible rows never include a
  skipped key.
- Hero = first eligible row in `rowOrder`; drafts in `mine` use `draftsOrder`.
- The hero is lifted out of its bucket: it is not repeated, and the bucket
  count excludes it.
- If no row is eligible, there is no hero. Do not render a placeholder.
- `mine` renders the **Up next** shape (accent rail); `review` and `all` render
  the **Needs you** shape (danger rail). `mine` falls back to the **Draft**
  shape; the other tabs never lift a draft.

Skip decision: `Skip` is hero-only and session-only. It adds the PR key to a
local skipped set, and the next eligible row becomes hero; the skipped row stays
in its bucket. When the skipped set covers every eligible row, it resets to
empty, so the hero cycles from the start instead of disappearing. The set
survives refetches in the same list mount, resets on tab or repo change, and is
never persisted to disk or the server. No other “skip” semantics exist.

### D3. Severity, dim and draft treatment

- `sev-blocked` uses `--danger`; `sev-warn` uses `--fg-muted`; `sev-wait` uses
  `--line-strong`.
- `is-dim` applies only to **Waiting on reviewers** (`mine`) and **Waiting on
  author** (`all`). It sets the title to `--fg-body` at weight 400 and the rail
  to `--line`. It composes with rest/hover/cursor and never with selected.
- Draft rows and the draft hero use a neutral `--line-strong` rail; drafts are
  never dim and never carry `sev-*`.
- Selection always wins over severity, dim and hover. Use the shipped
  `row-selected` utility; the 2px accent rail replaces the severity rail.

### D4. Counts, header and truncation

- Header count = number of visible rows after filters/search, **including the
  hero**. Unfiltered: `N open`. Filtered: `N of M open`.
- Bucket chip = bucket row count after filters, **excluding** the hero.
- Footer repeats the same count string plus the keyboard hint.
- Render every visible row. No per-bucket cap, no `17 more` row, no
  `6 of 23 open`.
- The rail's **All open** tab is the only “see everything else” affordance.

### D5. Selection, open, cursor and keyboard

- The open PR is the selected PR. There is no separate “selected but not open”
  state. Selection survives refetch and survives closing the detail; Enter
  reopens it.
- The keyboard cursor is independent of selection. Cursor movement never opens
  a PR and never starts a request.
- `j` / `ArrowDown` and `k` / `ArrowUp` move the cursor across the hero and all
  expanded bucket rows.
- `Enter` opens the cursor row. Clicking any row opens it immediately.
- Collapsed bucket rows leave the cursor sequence.
- Cursor is keyed by PR key, not index, so it follows a row across refetch. If
  the row disappears, clamp to the next row, then the previous, then the first.
- Initial cursor: the selected row if visible, otherwise the first row.
- Close the detail with Escape (existing behaviour). Do not add a new
  auto-open-on-rest timer; the old 150 ms preview behaviour is removed for the
  Deck.
- ARIA: use the contract's `role="listbox"` / `role="option"` model on the deck
  viewport, with `aria-activedescendant` pointing at the cursor option and
  `aria-selected` true only for the open PR. The hero's action buttons are
  siblings of the hero option, never descendants of an option. Bucket heads are
  `button` elements with `aria-expanded`; they are not options. The mock's
  “hero title is a button” is replaced by “the option is the click target”.
- Do not use `aria-selected` on the listbox itself. When there are no rows, the
  viewport falls back to `role="group"` (the existing list already does this).

### D6. Collapse, filters, search and persistence

- Bucket collapse is local component state keyed by `${tabID}:${repo ?? ""}` and
  bucket id. Default expanded.
- Collapse survives refetches and list rerenders in the same mount. It resets on
  tab or repo change and on app restart. Do not persist it.
- Filters and search run first, client-side, using the existing `filterPRs`.
  Then bucket, then order, then hero election. Bucket counts and hero election
  therefore always describe the filtered set.
- `hideDrafts` removes draft rows, hides the Drafts bucket and makes the draft
  hero fallback impossible.
- Search/facets never change the server query or the tab.
- If the selected PR is filtered out, keep the detail open and show no selected
  row.

### D7. Row reason and hero content

A row has exactly one reason string, first match wins:

```ts
changes_requested       -> "changes requested"
failing                 -> "checks failing"
reviewRequested         -> "review requested"
pending                 -> "checks running"
viewerReview approved   -> "you approved"
viewerReview changes_requested -> "you requested changes"
reviewState approved    -> "approved"
reviewState review_required -> "review required"
otherwise               -> "no review yet"
```

No thread counts in list rows. No “asked you a question”. No review-request
timestamp.

Hero content:

- `mine`: label **Up next** with the accent rail and accent micro label.
- `review` / `all`: label **Needs you** with the danger rail and danger micro
  label.
- Title: 16px / 24px, weight 500, `--fg`.
- Why line: `<reason> · <repo>#<number>`; `Needs you` prepends `<author> · `,
  because the hero is another person's PR. No author on `mine`.
- Age: `updated <relative>` from `updatedAt`. Do not invent “waiting since”.
- Facts, in order:
  - If a non-stale review summary exists: `N blocking` (danger tag) when N > 0,
    `N warning` when N > 0.
  - If the summary is stale: a neutral `review stale` tag instead of counts.
  - `N files`.
  - `+A −D` in mono.
  - No minutes.
- Actions: primary **Open PR** (opens preflight), outline **Open diff**, ghost
  **Skip**. The mock's hero **Start review** is deliberately not used: review
  starts from the preflight footer, where it opens the Review tab. It never
  submits a GitHub review and never auto-runs the automatic review.

Draft hero fallback:

- Label **Draft**, neutral rail, micro label in `--fg-muted`.
- Why line: `draft · <repo>#<number>`.
- Facts: `draft` tag, files, `+A −D` when present.
- Actions: primary **Open draft** (opens preflight), outline **Open diff**,
  ghost **Skip**.
- It uses the hero shape and the same six-state treatment as a ready hero.

### D8. Draft rows in the Drafts bucket

- Compact `.draft-row` per the mock, not the two-line deck row.
- Same rest / hover / cursor / selected recipes as a deck row; neutral rail;
  never dim. Selected uses `row-selected`.
- Draft rows have no severity class, no reason string and no review facts.
- Click/Enter opens preflight.

### D9. Briefing composition

Open PRs render the **Briefing**, not a tab strip. It is the only default
surface; merged/closed PRs keep the existing receipt (`PRSummary`) and show no
footer. The full contract lives in `docs/pr-detail-briefing.md`; this section is
the navigation and composition summary.

- `PRDetailBar` remains the only top bar (repo#number, branch, fullscreen,
  GitHub). No `PRHeader`, no tabs, no context rail.
- One scrolling body: the briefing header, Why, Context, Where the risk is,
  What changed, then the two latest conversation entries.
- A persistent 52px footer holds the one lit action (`Start review`), the
  Diff / Conversation / Explain place links (active place marked with
  `aria-current`) and Manage.
- Conversation, Diff, Review and Explain are **places** opened from the footer
  and returned from with a `Briefing` control. They have no tab semantics.

Briefing sections, in order, all conditional except Context:

| Section           | Render when                              | Source                    |
| ----------------- | ---------------------------------------- | ------------------------- |
| Why               | Any verdict/comment exists               | `pr.comments`             |
| Context           | Always                                   | `pr.description` only     |
| Where the risk is | A non-stale review artifact has findings | review artifact           |
| What changed      | The diff has a walkthrough with steps    | `diff.walkthrough`        |
| Conversation      | Any comment/verdict exists               | `pr.comments`, latest two |

Details:

- **Header**: kicker (Needs you only under the rule below, newest Why author +
  verdict/comment + age), title, author / branches / commits, checks and review
  status, and facts `+A −D`, `N files`, `N steps`, `N blocking`.
- **Needs you** appears only for `reviewState === "changes_requested"`, a
  failing/error check, or a review request opened from the `review` list tab.
  No label without one of those rules.
- **Why** label: `Why now` on `mine`, `Why you` elsewhere. Newest
  verdict/comment by another user on `mine`, newest by anyone elsewhere; prefer
  a verdict on a tie. Author, verdict/comment, relative time, body clamped to
  four lines. Hide when empty.
- **Context**: PR description through `Markdown`; empty renders
  `No description.` No Linear UI.
- **Where the risk is**: group findings by file, use the real
  `Finding.Category` (`Risk`, `Design`, `Architecture`, `Conventions`, `Tests`),
  sort by blocking/warning/nitpick/path, show at most three rows with severity
  dots capped at three. Click opens the Diff place at the first finding's file
  and line. Tail `N of M files`.
- **What changed**: one row per walkthrough step, deterministic title and
  `N files · +A −D`. Click opens the Diff place at the first file. Tail
  `N phases`. No prose, no anchor chips.
- **Conversation**: the two latest entries in chronological ascending order,
  body clamped to two lines, plus `All N entries` opening the Conversation
  place. The PR body is not a timeline entry.
- **Review cost section is gone.** Files, steps and blocking live in the header
  facts/status. No minutes, no complexity, no head-SHA fact.
- **Start review** opens the Review place; it never runs the review. The Review
  place keeps the existing run/re-run/cancel/stale behaviour.
- No keycap hints and no new `d`/`Enter` shortcuts.

### D10. Actions and navigation targets

| Action                    | Result                                                           |
| ------------------------- | ---------------------------------------------------------------- |
| Row click / Enter         | Select PR, open detail on **Briefing**                           |
| Hero **Open PR**          | Select PR, open detail on **Briefing**                           |
| Hero **Open diff**        | Select PR, open the **Diff** place, no target                    |
| Hero **Skip**             | Exclude from hero election for this mount; do not select         |
| Draft hero **Open draft** | Select PR, open **Briefing**                                     |
| Briefing risk row         | Open the **Diff** place at `{ path, line }` of the first finding |
| Briefing phase row        | Open the **Diff** place at `{ path }` of the step's first file   |
| Footer **Start review**   | Open the **Review** place                                        |
| Footer places             | Open Diff / Conversation / Explain; active place marked          |
| Place **Briefing** back   | Return to the briefing; restore its scroll position              |
| Manage                    | Approve, request changes, draft, close, squash merge             |

Cross-pane navigation from the list uses
`detailIntent: { prKey, view, diffTarget?, token }`; `PRDetail` consumes and
clears it. The view union is `briefing | conversation | diff | review | explain`.
Places keep local state; only the cross-pane intent lives in the store.

`Start review` means “open the Review place”. It is not a GitHub review
submission; the existing submit controls stay where they are. Escape clears a
confirmation or review form first, then returns a place to the briefing, then
leaves fullscreen, then closes the detail.

### D11. Width, repo panel and reflow

- Use the existing `cockpit` breakpoint (1180px).
- At `>= 1180px`: list column 340px (`w-85`), the detail pane takes the rest,
  matching the current split.
- At `< 1180px`: list and detail are mutually exclusive, as today. Selecting a
  row replaces the list; closing returns to it.
- Briefing: header meta wraps, risk rows become full-width rows, the footer
  wraps. No horizontal scrolling.
- The repo panel keeps its existing `sidebarOpen` / rail toggle. Do not add the
  mock's second hide button or a new collapsed-pane design.

### D12. Empty, loading, error and transient states

- Loading: keep the existing row-shaped skeleton. No hero placeholder.
- Empty tab: existing `EmptyState`.
- Filters match nothing: existing no-match `EmptyState` with Clear filters.
- Error: existing `ErrorState`; no deck chrome.
- No hero: omit it; start with the first bucket. No reserved gap.
- Empty bucket: omit it. No header, no count chip.
- Diff or review-artifact failure inside an otherwise loaded briefing: hide the
  affected section (risk / what changed / review counts) and keep header, why,
  context, conversation and footer. Do not add a second error surface.
- Detail error: existing `ErrorState`.

### D13. Visual and motion contract

- Use only existing theme tokens in `src/index.css`. Do not add colours.
- Reuse `row-selected` for the hero, deck rows and draft rows.
- Six row states exactly as the mock: rest, hover, cursor, selected, selected +
  hover, dim. Cursor is a 1px neutral ring; selected is the accent gradient plus
  the 2px accent rail; selected + hover keeps selection.
- Rail is the severity channel at rest; selection replaces it. Draft rows use a
  neutral rail.
- Hover fill `--surface` at 70%; severity bar grows to 3px; title warms toward
  accent. Dim uses the mock's muted title and line rail.
- Hero: no frame, no fill at rest, accent rail only for **Up next**; draft hero
  uses a neutral rail. Never implement the danger hero.
- Focus: 2px accent at 55% for buttons; cursor ring is neutral. Keep the
  existing global focus ring for controls outside the deck.
- Motion: 120ms state transitions, keycaps 80ms, reduced motion clamps
  everything to 0.01ms. No new animations.
- Do not add a z-index layer. Do not use raw zinc hex values.

## Resolution map

Every open item from `docs/deck-implementation.md` is closed by a decision:

| Original item                       | Decision               |
| ----------------------------------- | ---------------------- |
| 1. “First” order                    | D2                     |
| 2. Draft hero                       | D2, D7                 |
| 3. Buckets per tab                  | D1                     |
| 4. Counts and truncation            | D4                     |
| 5. Severity rail mapping            | D3                     |
| 6. Skip semantics                   | D2                     |
| 7. Open diff target                 | D10                    |
| 8. Collapse persistence and filters | D6                     |
| 9. Draft row states                 | D8                     |
| 10. Repo panel collapsed layout     | D11                    |
| 11. Narrow windows                  | D11                    |
| 12. Empty and edge states           | D12                    |
| 13. Markup vs contract              | D5                     |
| 14. Selected vs open                | D5                     |
| Hero/preflight size facts           | Contract changes       |
| Review counts / stale rule          | Contract changes, D9   |
| Review effort                       | Out (no minutes)       |
| Commit count                        | Contract changes       |
| Risk file categories                | D9                     |
| “What changed” prose                | D9                     |
| `waiting 22h`                       | D7 (`updated` instead) |
| Linear context                      | Out                    |
| Pre-review preflight                | D9                     |
| Semantic unavailable                | D9, D12                |

## Contract changes

### Go types

Add to `backend/internal/github/types.go`:

```go
type ReviewSummary struct {
    Blocking  int       `json:"blocking"`
    Warning   int       `json:"warning"`
    Nitpick   int       `json:"nitpick"`
    Praise    int       `json:"praise"`
    CreatedAt time.Time `json:"createdAt"`
    SHA       string    `json:"sha"`
    Stale     bool      `json:"stale"`
}
```

Add to `PR`:

```go
CommitCount       int            `json:"commitCount"`
ReviewRequested   bool           `json:"reviewRequested,omitempty" doc:"The viewer is a requested user reviewer; list responses only"`
ReviewSummary     *ReviewSummary `json:"reviewSummary,omitempty" doc:"Latest automatic review summary; list responses only"`
UnresolvedThreads int            `json:"unresolvedThreads,omitempty" doc:"Unresolved review threads; detail responses only"`
```

Update the `ViewerReview` doc comment: it is now populated on list responses too,
when GitHub reports a viewer review.

Do not add `reviewRequestedAt`, minutes, or a list-level unresolved-thread
count.

### GraphQL selection

`listFields` must add:

```graphql
headRefOid
additions
deletions
changedFiles
viewerLatestReview { state }
commits(last: 1) {
  totalCount
  nodes { commit { statusCheckRollup { state } } }
}
reviewRequests(first: 50) {
  nodes { requestedReviewer { ... on User { login } } }
}
```

`detailQuery` must add `totalCount` to `commits(last: 1)` and `isResolved` to
each `reviewThreads` node.

Mapping changes:

- `toPR` sets `HeadSHA`, `Additions`, `Deletions`, `ChangedFiles`,
  `CommitCount`, `ViewerReview` and `UnresolvedThreads` (count of
  `!isResolved` in the first 50 detail threads).
- `ListPRs` sets `ReviewRequested` by comparing requested user reviewers with
  `result.Viewer.Login`.
- Remove the now-redundant `GetPR` assignment of `ViewerReview` if `toPR`
  supplies it.

### Review summary enrichment

In `getPRs`, after `loadCached` returns the GitHub list:

1. Find the configured action whose `Kind == "review"`; if none, leave every
   `ReviewSummary` nil.
2. For each PR, call `s.artifacts.Latest(owner, repo, number, action.ID)`.
3. If an artifact with a non-nil `Review` exists, attach a `ReviewSummary` with
   counts over `Review.Findings`, `CreatedAt`, `SHA`, and
   `Stale = pr.HeadSHA == "" || artifact.SHA != pr.HeadSHA`.

Attach summaries **after** the cached read, every request. Never cache the
enriched list in the provider cache: artifact changes must be visible on the
next list read.

### Cache and OpenAPI

- Bump the list cache route, e.g. `prListRoute = "prs-v2"`, and use it in both
  `getPRs` and `invalidateListKey`.
- Bump `prDetailRoute` to `pr-detail-v7` for the new detail fields.
- Bump `apiVersion` for the contract change.
- Run `make api`; commit `openapi.json` and `src/lib/generated`.

### TypeScript facade

`src/lib/types.ts` keeps aliasing the generated types. Do not hand-write these
fields. The new generated types are:

```ts
type ReviewSummary = {
  blocking: number;
  warning: number;
  nitpick: number;
  praise: number;
  createdAt: string;
  sha: string;
  stale: boolean;
};
```

`Pr` gains `commitCount: number`, `reviewRequested?: boolean`,
`reviewSummary?: ReviewSummary`, `unresolvedThreads?: number`.

## Frontend structure

- Add a pure `src/features/prs/deck.ts` with:
  - `bucketFor(pr, tab, viewer)`
  - `severityFor(pr)`
  - `reasonFor(pr)`
  - `deckOrder(prs, tab, viewer)`
  - `buildDeck(prs, tab, viewer, skipped)` returning `{ hero, buckets, rows }`
  - bucket label/order constants.
- Unit-test that module. Do not test wiring or copy.
- Replace the flat row map in `PRListBody` with the deck renderer. Reuse the
  existing toolbar, filter chips, scroll edges, empty/error/loading states and
  the selected-PR store.
- Add `DeckRow` and `DraftRow` components; keep `PRRow` only if another surface
  still uses it, otherwise delete it.
- Add `Briefing`, `PlaceShell`, `PlaceBar` and `ManageMenu` under
  `src/features/prs/detail/`. Pass the briefing the detail PR, review
  controller, diff walkthrough and the existing `openInDiff` callback.
- Use the `DetailView` union (`briefing | conversation | diff | review |
explain`); the briefing is the default for open PRs, merged/closed falls back
  to the receipt.
- Put the briefing header inside the briefing body (`Briefing.tsx`). Delete
  `PRHeader`, `PreflightTab`, `DetailTabs`, `DetailPanel` and `ContextRail`.
- Add the minimal `detailIntent` store field for hero actions, as described in
  D10.
- Remove the list's 150ms open-on-rest preview for the Deck; j/k only moves the
  cursor.

## Acceptance checklist

- `mine` renders one hero and at most four buckets; `review` and `all` render no
  hero.
- Hero is the first non-draft eligible row in deck order; fallback is the first
  non-skipped draft. Hero is not repeated in its bucket; bucket counts exclude
  it.
- `Skip` re-elects without removing the row; skipped keys reset on tab/repo
  change and survive refetch.
- Bucket assignment, severity, dim and ordering match D1–D3 exactly. Drafts
  override every other bucket.
- Filters and `hideDrafts` affect rows, counts and hero election. Collapse
  survives refetch and resets on tab/repo change.
- Header/footer counts follow D4; there is no “more” row and no truncation.
- j/k moves the cursor without opening; Enter opens; mouse opens immediately;
  collapsed rows are skipped; selection is the open PR and survives close.
- Briefing is the default open-PR surface; Why/Context always follow D9; risk,
  what-changed and conversation appear only with their data; risk categories are
  the real finding categories; risk/phase clicks land in the Diff place at the
  specified target. No tab strip anywhere; one 44px bar and one 52px footer.
- No Linear UI, no minutes, no danger hero, no second detail bar, no new
  colours.
- New list fields are present in `openapi.json` and `src/lib/generated`.
- Backend: `cd backend && go build ./... && go vet ./... && go test ./...`.
- Frontend: `bun run fix && bun run typecheck && bun run test`.
- Contract: `make api` committed; `make verify-api` passes.

## Deferred without placeholders

- Linear context.
- Review effort in minutes.
- List-level unresolved-thread counts and “asked you a question” reasons.
- “Needs you” danger hero.
- Bucket truncation / “more” rows.
- Preflight inline diff annotations.
- Collapsed repo-panel redesign.
- Loading/empty/error illustration work beyond the existing components.
