# Deck — implementation notes and open decisions

Source design: `mock/ui-directions.html`, story 01 (`:1010-1300`) and the state
contract (`:1863-2023`). This note separates what is ready to build from what
still needs a product or contract decision before the Deck can be implemented
end to end.

Status: visual layer ready; data layer incomplete. Decisions recorded
2026-11-26.

## Decisions recorded

1. **One hero per list.** `mine` renders the "Up next" hero: the first
   non-draft PR in the list's current order, with the first draft as fallback.
   `review` and `all` render the mock's danger "Needs you" hero: the first
   non-draft row that needs the viewer (`review` rows, and the `needs` bucket
   on `all`). Other tabs never promote a draft.
2. **Linear is out of scope.** The Context section shows the PR description
   only. No Linear tab, no Linear metadata, and no `Link issue` button — not
   even as a disabled placeholder.
3. **"Other details" are deferred**, not designed. They remain listed below so
   they are not silently invented during implementation.

## Ready to implement

- Row geometry and the six-state matrix: rest, hover, cursor (`deck-cursor`),
  selected, selected + hover, dim (`:1863-1918`, `:2010-2023`).
- Hero states and the two-bucket recipe (`:1919-1975`).
- Bucket head, count chip, collapsed chevron/body (`:286-295`, `:2021-2022`).
- Selection recipe shared with repo rows and the existing shipped utility
  (`:852-880`; `src/index.css:222`).
- Focus, press, keycap travel, reduced motion, z-index (`:785-830`,
  `:2054-2091`).
- Aria mapping (listbox/option + `aria-activedescendant`, tabs, toggles) is
  stated in the contract even though the mock markup does not implement it.

## Data gaps — server work required

| Deck element | Mock ref | What exists now | What is missing |
|---|---|---|---|
| Bucket assignment and row reason (`checks failing · 2 threads`, `asked you a question`, `you approved · 1 open thread`) | `:1087-1120` | List returns `checkStatus`, `reviewState`, `isDraft`, `updatedAt` (`backend/internal/github/queries.go:5-18`) | List has no `viewerLatestReview`, no review-request time, no unresolved-thread count. `reviewThreads` does not request `isResolved` (`queries.go:81-85`). `viewerReview` is detail-only (`types.go:41-49`). |
| Hero and preflight size facts (`9 files`, `+312 −147`) | `:1071-1077`, `:1153-1156` | Detail returns additions, deletions, changedFiles (`queries.go:61-67`) | List query omits them, and the hero must render before its PR is selected. |
| Review counts (`2 blocking`, `Review found 2 blocking`, `last run 2h ago`) | `:1071`, `:1175`, `:1287-1294` | Review artifact carries findings, `createdAt`, SHA; the action response exposes a `stale` flag (`backend/internal/actions/artifact.go:36-44`, `backend/internal/api/responses.go:86-90`) | No list or batch summary. One artifact lookup per PR. Rule for a stale artifact (head moved) is undefined. |
| Review effort (`~8 min`) | `:1077`, `:1294` | Nothing | No duration or estimate field. Complexity yields only high/medium/low (`backend/internal/diff/complexity.go:15-23`). Drop unless a formula is specified. |
| Commit count (`4 commits`) | `:1170`, `:1233` | Only `commits(last: 1)` for check rollup | No `totalCount` in the query or `PR` type. |
| Risk file categories (`correctness`, `concurrency`, `observability`) | `:1243-1253` | `Finding.Category` is `risk/design/architecture/conventions/tests` (`backend/internal/review/types.go:30-38`) | Mapping between the mock labels and the real enum, or new labels. |
| "What changed" prose phases with anchors | `:1260-1284` | Walkthrough steps have deterministic titles, files, additions/deletions (`backend/internal/diff/walkthrough.go:21-27`) | No prose summaries per step and no rule for which line an anchor chip shows. |
| `waiting 22h` | `:1065` | `updatedAt`; review verdict timestamps in the detail conversation | No review-request timestamp, so "waiting since" is undefined. |
| Linear context | `:1190-1230` | Config holds team keys only | No client, route or types. Removed from scope by decision 2. |
| Pre-review preflight | `:1152-1304` | — | The mock assumes an existing review. A PR with no review has no risk, cost or walkthrough section; its composition is not drawn. |
| Semantic unavailable | — | `semanticAvailable`, optional `semanticSummary`, `walkthrough`, `complexity` (`backend/internal/diff/diff.go:76-83`) | The cost/risk sections when `sem` is missing are not designed. |

## Composition and behaviour still to decide

1. **"First" means what order?** List ordering within a bucket is not defined;
   hero election uses it. Recency, severity, or a fixed state order?
2. **Draft hero.** When the fallback hero is a draft, does it take the hero
   shape (with which actions, given review requires a non-draft), or does the
   hero disappear and drafts stay compact rows?
3. **Buckets per tab.** "Blocked on you / Waiting on author" only makes sense in
   some tabs. In Review requested, submitting a review removes you from the
   requested list, so "Waiting on author" cannot appear there. My PRs inverts
   both labels. Define the bucket set per tab, or accept that only My PRs uses
   these three buckets.
4. **Counts and truncation.** The mock's header says `6 open` (`:1052`), the
   footer says `6 of 23 open` (`:1146`), and the more row says `17 more`
   (`:1140`). Decide whether the header is the tab total or the rendered count,
   and whether buckets are complete or capped.
5. **Severity rail mapping.** `sev-blocked / sev-warn / sev-wait` are styled
   (`:303-309`) but not defined in terms of PR state.
6. **Skip semantics.** The mock says "move to the next row without opening"
   (`:1080`); persistence and whether it affects the list are undefined.
7. **Open diff target.** Risk rows jump to Anchor and Start review jumps to
   Review, but Open diff (`:1078`, `:1090`) has no target in the deck.
8. **Collapse persistence and filters.** Whether collapsed buckets survive a
   refetch, and how facet filters/search interact with grouping and hero
   election.
9. **Draft row states.** The contract covers only rest/hover (`:2023`); cursor,
   selected and severity treatment for draft rows are absent.
10. **Repo panel collapsed layout.** The hide button exists (`:1032`) but no
    story shows the collapsed pane.
11. **Narrow windows.** The mock's fixed 1440 frame is zoomed (`:938-939`); the
    real window is resizable. Preflight reflow and pane priority at narrow
    widths are not designed.
12. **Empty and edge states.** Loading/empty/error are declared out of scope
    (`:2091`). An empty bucket and the absence of a hero are composition states,
    not transient ones, and are still undrawn.
13. **Markup vs contract.** The contract requires `role="listbox"`,
    `role="option"` and `aria-activedescendant` (`:43-45`, `:2012`); the deck
    markup uses plain buttons and an `<article>` hero. Implement from the
    contract, not the markup.
14. **Selected vs open.** The hero is never shown as `is-selected` in the story;
    whether the open PR is always the selected row, and how selection differs
    from the keyboard cursor on the hero, is only described in the spec sheet.

## Suggested minimum contract changes

Only what the recorded decisions cannot avoid:

- Extend list rows with `viewerLatestReview`, `reviewRequests` (timestamp),
  `additions`, `deletions`, `changedFiles`, `commitCount`, and per-PR
  unresolved-thread count.
- A small review-summary shape once per PR (counts by severity, `createdAt`,
  `sha`, `stale`) so the hero can show review facts without one artifact
  request per row.
- Drop `~8 min` unless a minutes formula is accepted.
- Define the `Finding.Category` → risk-label mapping.
- Define how a walkthrough step renders as a "What changed" phase.

Linear, minutes, and the undecided composition items above stay out until
someone asks for them.
