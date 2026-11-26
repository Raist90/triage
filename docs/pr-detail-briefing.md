# PR detail — Briefing (proposal B) plan

Source design: `mock/pr-detail-proposals.html`, story 02 (`:1281-1591`), shared
place chrome (`:599-608`). Evaluation notes: `:1900-2040`. This note records
what is decided, what can be built from existing data, and what still needs a
product or contract decision. It is the implementation input for replacing the
current tabbed PR detail with B's briefing.

Status: **implemented 2026-11-26**. The open-PR detail is the briefing plus
places; `DetailTabs`, `DetailPanel`, `PRHeader`, `PreflightTab`, `ContextRail`,
`ExplainTab`, `ReviewHeaderActions` and `ComplexityMeter` are deleted. Decisions
recorded 2026-11-26.

Precedence: this file supersedes the navigation parts of
`docs/deck-decisions.md` D9/D10 (tab strip, Preflight tab, per-tab composition)
once the briefing ships. The deck contract still owns list grouping, hero
election, row states and the detail bar. The mock owns geometry, type, colour,
hover, focus and motion.

## Decisions recorded

1. **B is the pane.** Open PRs render a single briefing document. The second
   navigation is deleted: no tab strip, no Preflight tab, no underline tabs.
   The 44px detail bar is the only chrome above the body. A 52px footer holds
   the one primary action, the place links and Manage.
2. **The diff is out of scope.** Keep the shipped diff exactly as it is:
   `DiffView`, its 208px resizable file rail, semantic map, per-file sections,
   inline comments, toolbar and scroll behaviour. B only adds the entry and the
   return path around it. Do not adopt B's `diff-mini` mock.
3. **Conversation and Explain become places.** Both are full views opened from
   the footer and returned from with a Briefing back control. Conversation
   keeps the existing timeline and inline review comments; Explain is reworked
   as an on-demand place (empty, running, artifact, stale, error), not a bare
   text block with a button in a tab.
4. **Review becomes a place too**, because the tab strip no longer exists.
   `Start review` opens it. The existing `ReviewTab` body is reused unchanged:
   empty, running, artifact, verdict, findings, apply-patch and stale states.
   This is not a new cockpit or a new route.
5. **Briefing is for open PRs only.** Merged/closed PRs keep the `PRSummary`
   receipt unchanged: no briefing, no footer places, no live actions.
6. **Context is the PR body.** Per `docs/deck-decisions.md`, Linear is out of
   scope. Do not render the mock's Linear card, issue status, priority, cycle,
   acceptance progress, or a disabled `Link issue` placeholder. When a PR has
   no description, render `No description.` as today.
7. **No duration estimate.** Drop `~8 min` from the header facts. The walkthrough
   can supply `6 steps`; nothing supplies minutes. This matches the deck
   decision.
8. **No prose is invented for “What changed”.** Render the deterministic
   walkthrough step title plus `N files · +A −D`. The mock's prose paragraphs
   and `session.ts:145` anchor chips need backend data that does not exist.
   Keep the existing first-file jump. Add prose and precise anchors only when
   the walkthrough carries them.
9. **The header scrolls with the briefing.** Remove the fixed `PRHeader` above
   the tab strip. The title, kicker, meta, status and facts live at the top of
   the briefing body, per the mock. The detail bar identifies the PR
   (`repo#number`, branch) while a place is open.
10. **Footer is persistent.** It stays visible in Briefing and every place, the
    active place is marked, and `Start review` remains the only lit action.
    Manage carries approval, request-changes, draft, close and merge. The
    existing confirmation bars for merge/close remain above the body.

## Ready to implement

- **Pane shell.** `PRDetailBar` (44px) → scrolling body → `PlaceBar` (52px).
  Fullscreen keeps its current behaviour. Loading, error and receipt branches
  keep their current layout.
- **Briefing header** (`:1395-1414`): kicker (`Needs you` + reason + age), title,
  author/branch/commits, status line, facts. All data exists:
  `pr.title`, `pr.author`, `pr.branch`, `pr.baseBranch`, `pr.commitCount`,
  `pr.updatedAt`, `pr.checkStatus`, `pr.reviewState`, `pr.additions`,
  `pr.deletions`, `pr.changedFiles`, the newest comment/verdict, the review
  artifact counts, and `diff.walkthrough.steps.length`.
- **Why you** (`:1416-1426`): reuse `whyEntry` and `verdictLabel` from
  `PreflightTab`; keep the `Why now` label on `mine` and `Why you` elsewhere.
  Tail is the relative time. The mock's `on <sha>` is deferred: `Comment`
  carries no commit SHA.
- **Context** (`:1427-1447`): PR description via `Markdown`; empty copy
  `No description.`
- **Where the risk is** (`:1448-1456`): reuse `riskFiles` and the real
  `Finding.Category` labels (`Risk`, `Design`, `Architecture`, `Conventions`,
  `Tests`), max three rows, severity dots capped at three, row jump to the
  first finding's file and line.
- **What changed** (`:1457-1477`): one row per walkthrough step, deterministic
  title, `N files · +A −D`, click opens the first file in Diff. Tail `N phases`.
  Hide the section when `walkthrough` is absent.
- **Recent conversation** (`:1478-1499`): two latest timeline entries inline,
  author, action/verdict, relative time, body clamped to two lines. `All N
  entries` opens the Conversation place. Description is not a timeline entry
  here; Context owns it.
- **Conversation place** (`:1501-1538`): place header with Briefing back,
  title, and `N entries`. Full timeline of comments, verdicts and inline review
  comments. Existing `Conversation` component supplies the entries; add the
  composer only after the submit decision below.
- **Diff place** (`:1539-1564`): place header with Briefing back, title and
  `N files · +A −D`; body is the current `DiffTab` at full width. No centred
  `74ch` wrapper, no mock diff, no change to `DiffView`.
- **Review place**: place header with Briefing back, title `Review`; body is the
  current `ReviewTab` with its existing run/re-run, findings, verdict, apply and
  stale behaviour.
- **Explain place** (`:1565-1580`): place header with Briefing back, title
  `Explain`, tail `on demand` or the artifact time. Empty state through
  `StateView` (`Sparkles`, `No explain artifact for this head`, explanation,
  action `Explain this PR`). Running streams live markdown and offers cancel.
  An artifact renders model, time and cost meta, stale warning with Re-run, and
  the markdown. Errors use a danger `StateView` with Retry. If Explain is not
  configured, the footer entry is absent and a forced explain view falls back
  to Briefing.
- **Footer** (`:1581-1590`): primary `Start review`; place links `Diff`,
  `Conversation` with count, `Explain` when configured; active place marked;
  Manage at the right. Keyboard hints only if the keys are implemented.
- **Place semantics.** No tablist remains. Footer entries are navigation
  buttons with `aria-current` for the active place. The back control returns to
  Briefing. Focus moves to the place heading on open and back to the originating
  footer control on return.
- **Cross-pane intent.** Replace `DetailIntentTab` with the new view union and
  map row clicks/hero opens to `briefing`, hero `Open diff` to `diff`. Keep the
  existing token mechanism.
- **Remove the old navigation.** `DetailTabs`, `DetailPanel` and the fixed
  `PRHeader` go away. `ContextRail` goes away after its facts are folded into
  the briefing header/facts; the diff already hides it.
- **Keep the confirmation and review-form bars.** `ReviewPanel` and
  `PRStatePanel` stay between the detail bar and the body so a merge, close or
  request-changes confirmation cannot scroll away.

## Data gaps

| Briefing element | Mock ref | What exists | Gap / decision |
|---|---|---|---|
| Kicker `Needs you` + `l.okafor requested changes` + `22h ago` | `:1396` | `pr.comments` newest verdict, `pr.reviewState`, `pr.checkStatus` | No `needs` predicate. Derive from review/check state and the list tab, or use the hero severity rule. Do not invent a new field for v1. |
| `22h ago` on Why | `:1417` | `Comment.createdAt` | `Comment` has no commit SHA, so the mock's `on 7f3a9c2` is not renderable from the Why entry. Show the relative time, or `on <pr.headSHA>` only if the head is an acceptable stand-in. |
| `6 steps` | `:1410` | `diff.walkthrough.steps` | Absent when `sem` is unavailable; hide the fact. |
| `~8 min` | `:1411` | Nothing | Dropped. |
| Review counts `2 blocking · 3 warning` | `:1405`, `:1413` | Review artifact via `useClaudeAction` | Counts only exist when a Review action is configured and an artifact exists. Hide the counts otherwise; keep checks and review-state status. |
| Linear context card | `:1428-1447` | Config has team keys only; no client, route or types | Deferred with no placeholder, per decision 6. |
| “What changed” prose + anchor chips | `:1459-1475` | `WalkthroughStep.title`, `files`, `additions`, `deletions` | No prose and no line anchor. Keep title/meta and first-file jump. |
| Recent two entries | `:1480-1494` | `pr.comments` | Selection and order are undefined; see open items. |
| Conversation composer | `:1533-1537` | `POST /review` with `COMMENT`; inline diff-comment routes | No general issue-comment endpoint. A composer either submits a `COMMENT` review through the existing route or needs a new Go route, cache invalidation and types. |
| Explain empty/running/artifact states | `:1565-1580` | `useClaudeAction` (`artifact`, `running`, `liveText`, `stale`, `error`) | UI only. Prompt and artifact schema stay unchanged. |
| Complexity, head commit, status facts | Current `ContextRail` | `diff.complexity`, `pr.headSHA`, `pr.checkStatus` | B's mock does not show complexity. Fold what survives into the briefing facts; drop complexity from the pane unless a new home is chosen. |

## Composition and behaviour still to decide

1. **Conversation order and selection.** The mock's place tail says “newest
   first” but its entries read 22h → 19h → 3h (oldest first), and the inline
   block shows 22h then 3h. Choose one order for both: chronological ascending
   is the current timeline and keeps a review thread readable. Inline should
   then show the latest two in ascending order. Remove the contradictory tail.
2. **Does the PR description stay in the Conversation place?** Today
   `buildEntries` prepends it. B moves it to Context. Recommend removing it from
   the timeline for open PRs so the body appears once. Receipts and other
   surfaces are unaffected.
3. **Composer behaviour.** Options: (a) no composer in v1, matching the current
   app's lack of issue comments; (b) submit a `COMMENT` review through
   `POST /pr/.../review`; (c) add a real issue-comment route. (b) is smallest
   but a review comment is not the same as a conversation comment. Decide
   before drawing the composer.
4. **Review vs “leaves the pane”.** The mock says Review is a CTA that leaves
   the pane, but the app has no separate review window. The plan reuses the
   Review tab body as a place. Confirm that `Start review` opens a place rather
   than a modal or the diff.
5. **Start review: open or run.** Current behaviour opens the review surface and
   leaves the run button there. Keep that, or make the footer CTA start the
   action immediately? Recommendation: keep the two-step path; running is
   explicit and the existing Review place owns cancel/retry.
6. **Escape precedence.** Current Escape: composer → confirmation → review form
   → fullscreen → close detail. With places, add “place → Briefing” before
   fullscreen/close. Decide whether Escape in a place from fullscreen returns to
   Briefing first or exits fullscreen first.
7. **Keyboard hints.** The mock advertises `enter review`, `d diff`, `esc
   close/return`. None of the detail shortcuts exist today. Implement them or
   omit the hints; do not ship dead keycaps.
8. **“Needs you” predicate.** Define it from `reviewState`, failing checks,
   `reviewRequested` and the opened list tab. Until then, use a neutral kicker
   or the existing Why line rather than a label with no rule.
9. **What happens to complexity and the head SHA.** They currently live in
   `ContextRail`. If the rail is deleted, choose: add a compact fact line to the
   briefing, move them into Review cost, or drop them. B does not draw them.
10. **Place empty states.** Conversation can be empty (no comments beyond the
    description) and Diff can be empty. Reuse `StateView`; do not leave a blank
    place with only a back link.

## Implementation decisions (2026-11-26)

Every item under “Composition and behaviour still to decide” is resolved as
follows and is what shipped:

1. **Conversation order:** chronological ascending everywhere. The briefing's
   inline block shows the latest two in ascending order and the place drops the
   contradictory “newest first” tail.
2. **Description:** removed from the timeline; Context owns the PR body for open
   PRs, so it appears once.
3. **Composer:** none in v1. The Review place keeps the review form; there is no
   issue-comment route.
4. **Review:** `Start review` opens the Review place; no modal, no route, no
   separate window.
5. **Start review:** still opens the place without running. Running stays an
   explicit action in the place with cancel/retry.
6. **Escape:** confirmation → review form → place → Briefing → fullscreen →
   close. A place returns to the briefing before fullscreen is left.
7. **Keyboard hints:** omitted. No `d`/`Enter` detail shortcuts were added, so
   no dead keycaps ship.
8. **Needs you:** `reviewState === "changes_requested"`, a failing/error check,
   or a review request opened from the `review` list tab. Otherwise the kicker is
   neutral or absent.
9. **Complexity and head SHA:** dropped from the pane. Complexity has no home
   in B; the head SHA remains on the merged/closed receipt and the review
   artifact. The detail bar shows `repo#number` and the branch.
10. **Empty places:** Conversation uses `StateView`; Diff keeps its shipped
    `No file changes.` message and loading/error states; Explain has its own
    empty/running/artifact/stale/error states.

Two implementation edges follow the same rule: `Start review` is disabled when
no review action is configured, and a requested Review/Explain place falls back
to Briefing when its action is absent. Explain stays absent from the footer when
unconfigured.

## Suggested contract changes

Frontend only, unless a real conversation composer is chosen:

- Replace `DetailTab`/`DetailIntentTab` with:

  ```ts
  type DetailView = "briefing" | "conversation" | "diff" | "review" | "explain";
  ```

  Update `src/stores/ui.ts`, `PRList` intents and `PRDetail` local state.
- No OpenAPI change for briefing, Conversation, Diff, Review or Explain: their
  data already exists in `Pr`, `Response`, `ActionArtifact` and `Review`.
- If the composer is built as a real issue comment, add a Go request/response,
  a `POST /pr/{owner}/{repo}/{number}/comment` route, cache invalidation for the
  detail and list, `make api`, and the facade types.
- If “What changed” should show prose or anchors, extend `WalkthroughStep` with
  the prose and anchor tuple in Go; do not synthesise it in React.

## Frontend structure

- `src/features/prs/PRDetail.tsx`: replace tab state with place state; render
  Briefing or the active place; persistent footer; wire intent and Escape.
- `src/features/prs/detail/Briefing.tsx`: new. Header, Why, Context, risk,
  changes, recent conversation. Absorbs the useful parts of `PreflightTab`.
- `src/features/prs/detail/BriefingHeader.tsx`: new, or keep `PRHeader` and move
  it inside the briefing scroll. It must no longer be fixed above the tabs.
- `src/features/prs/detail/PlaceShell.tsx`: new. Back to Briefing, place title,
  tail, body width rules (`centered` for prose, `full` for Diff).
- `src/features/prs/detail/PlaceBar.tsx`: new. Primary CTA, place links, Manage.
- `src/features/prs/detail/ManageMenu.tsx`: new. Hand-rolled popover using the
  existing `PRFilterPopover` pattern; no new dependency. Items mirror
  `ReviewHeaderActions` + `PRStateActions`, with disabled reasons preserved.
- `src/features/prs/detail/Conversation.tsx`: split the entry builder from the
  timeline; add `RecentConversation` for Briefing and keep the full timeline
  for the place.
- `src/features/prs/detail/ExplainPlace.tsx`: new. StateView empty/error, live
  markdown, artifact meta, stale Re-run, cancel. Reuse `useClaudeAction`.
- `src/features/prs/detail/DiffTab.tsx`: keep as the Diff place body; add no
  visual changes. `DiffView` and `src/features/prs/diff/*` stay untouched.
- `src/features/prs/review/*`: keep `ReviewTab` and findings as the Review place
  body; only its outer width/header may move into `PlaceShell`.
- Delete `DetailTabs.tsx` and fold `DetailPanel`'s scroll edges into
  `PlaceShell`/the briefing body. Delete `ContextRail.tsx` once facts move.
- Update `src/features/prs/PRDetail.test.tsx` for briefings/places and replace
  tab assertions. Keep the diff test coverage; add cases for place return,
  Explain empty/artifact, and Briefing recent conversation.

## Acceptance checklist

- Open PR defaults to Briefing; merged/closed still renders the receipt.
- No tab strip anywhere in the detail pane; the 44px bar plus 52px footer are
  the only permanent chrome.
- Briefing order: header, Why, Context, risk, changes, recent conversation.
  Sections hide cleanly when data is absent.
- Recent conversation shows two entries and opens the full place; the place
  returns to Briefing without losing the briefing's scroll position.
- Diff is byte-for-byte the shipped diff surface; only its wrapper and return
  path change. No `diff-mini`, no narrowed file rail, no new diff chrome.
- Conversation and Review keep their existing content and actions. Explain
  matches the reworked empty/running/artifact/stale/error states.
- Review and state actions are reachable from Manage; confirmation bars still
  outrank the body and Escape handles them first.
- Explain is absent from the footer when its action is not configured.
- `bun run fix`, `bun run typecheck`, `bun run test` pass.
- `docs/deck-decisions.md` D9/D10 and the `frontend` skill's PR-detail rules
  are updated once the briefing replaces the tab model.

## Deferred without placeholders

- Linear issue card, status, priority, cycle and acceptance progress.
- Review minutes.
- Walkthrough prose and per-step line anchors.
- Context rail complexity and head facts until their new home is chosen.
- A real conversation comment composer until the submit decision is made.
- Any change to the diff renderer.
