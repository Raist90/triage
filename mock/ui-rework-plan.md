# UI rework — implementation plan

Source of truth: `mock/ui-rework.html` (artboards 01 Cockpit, 02 Review).
This plan maps that mock onto `src/` and records what must be decided before
code starts. No backend or OpenAPI change is required; every fact the mock shows
already exists on `Pr`, `Comment` or the review/explain artifact.

## Verdict: not implementation-ready yet

The visual spec is complete and internally consistent, but it is a **second
information architecture**, not a restyle. Implementing it as drawn deletes four
shipped behaviours and adds one that the product scope currently forbids.

Resolve these before Phase 0:

| #   | Question                                                                                                                                | Why it blocks                                                                 | Recommendation                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Inline review findings in the diff are listed under **Out** of MVP in `AGENTS.md` ("Review jumps first, annotation later"). Adopt them? | The mock's whole second artboard depends on it.                               | Adopt; update the MVP section and `.skills/frontend/SKILL.md` in the same change.                                                                       |
| D2  | Keep fullscreen? The mock's rules call it "out of scope for this pass" and omit it.                                                     | It is a shipped feature with a documented rule.                               | Keep. The mock omitted it to keep the artboard simple, not to remove it.                                                                                |
| D3  | Keep diff controls the mock drops: file search/filter, sort, hidden file kinds, focus mode, path/walkthrough mode, semantic map?        | They are working features; silently deleting them is a regression.            | Keep behaviour, relocate: a `Files` popover in the strip. Semantic map stays optional and off by default.                                               |
| D4  | Keep the resizable file rail? The mock is one scroll with 44px file headers.                                                            | Removing the rail also removes the visible j/k cursor.                        | Remove the rail. Keep j/k over file headers and flash the landed header.                                                                                |
| D5  | Right bar width and responsiveness. Mock: 300px at 1440. At the 1180 cockpit breakpoint the document would be ~284px.                   | Fixed 300 is unusable on smaller windows, and the list stays mounted at 1180. | Keep list at 340 (mock's 376 is artboard-only). Bar 300 at >= 1400; below that it is hidden and toggled from the detail bar (Zustand, like fullscreen). |
| D6  | "Reply" on a finding appears in the mock. There is no publish/reply contract.                                                           | Building it would cross the "never publish" MVP line.                         | Omit Reply. Keep Apply patch; a finding is a read-only artifact.                                                                                        |
| D7  | Review submission (`ReviewPanel`: request changes / comment) has no home in the mock.                                                   | It is shipped MVP.                                                            | Render `ReviewPanel` at the top of the bar, above the Review section, when `review.open`.                                                               |
| D8  | Bar height 44 vs current 52 footer.                                                                                                     | Shared band token.                                                            | Use 44; it matches the detail bar and the mock's "one band".                                                                                            |

If any of D1–D4 is answered "keep the old flow", stop: the change is no longer
this mock and needs a different design.

## Facts and owners

One fact, one surface. This is the rule the mock enforces:

| Fact                                                  | Owner                                |
| ----------------------------------------------------- | ------------------------------------ |
| PR title, author, why-you, age, repo#number           | PR list hero (unchanged)             |
| Repo#number, branch → base, GitHub link, Manage       | Detail bar                           |
| PR body                                               | Context row, collapsed               |
| Files, +/−, commits, checks, head SHA                 | Diff strip                           |
| GitHub review state                                   | Right bar, Review section, one badge |
| Review verdict, severity strip, counts, finding index | Right bar, Review section            |
| Finding text                                          | Inline thread under its diff line    |
| Conversation                                          | Right bar, Conversation section      |
| Explanation                                           | Right bar, Explain section           |
| Primary action (`Start review` / `Re-run review`)     | Right bar footer                     |

The detail pane prints none of: title, author, branch (bar has it), review state
twice, or a second toolbar between the body and the code.

## Target component shape

```
PRDetail
├─ PRDetailBar            identity · branch · [bar toggle <1400] · fullscreen · Manage · GitHub
├─ PRStatePanel           merge/close confirm + action error (unchanged)
└─ PRDetailBody
   ├─ document (grid 1fr)
   │  ├─ ReviewPanel?      review form, when open
   │  ├─ ContextRow        accordion, Markdown, hidden when description empty
   │  ├─ DiffStrip         facts + comments toggle + Files popover
   │  └─ DiffView          one scroll: 44px file heads + hunks + threads
   └─ ReviewBar (300)
      ├─ ReviewSection     state badge · verdict · counts · 6-row index
      ├─ ConversationSection
      ├─ ExplainSection
      └─ footer            Start review / Re-run · Cancel
```

No `PlaceShell`, no place headers, no tab footer, no `Briefing`.

## Phases

Each phase compiles and ships green; do not start the next before the previous
passes `bun run fix && bun run typecheck && bun run test`.

### Phase 0 — tokens and primitives

- `src/index.css`: no new colors. Add only a breakpoint for the bar
  (`--breakpoint-wide: 1400px`) if D5 is accepted.
- `src/index.css` spacing audit: the mock uses 12/24 gutters and one 44 band.
  Bring detail code to that; delete one-off `px-7`, `h-13`, `h-9` in the diff.
- New `src/features/prs/detail/DiffStrip.tsx` skeleton (facts left, controls
  right). No behaviour yet.

Acceptance: no visual change outside the detail strip; tests unchanged.

### Phase 1 — detail shell

Files:

- `src/features/prs/PRDetail.tsx` — rewrite the body.
  - Delete `viewState`, `DetailView` switching, `briefingRef` scroll restore,
    place focus restoration, and the `PlaceShell`/`PlaceBar` branches.
  - Keep: detail/diff queries, live refresh, merge polls, PRStatePanel, Escape
    chain (confirm → composer → Context open → fullscreen → close), receipt.
  - `detailIntent` shrinks to `{ prKey, target?: "diff" | { path, line } }`.
    Row click opens the document with Context collapsed; hero "Open PR" is the
    same; hero "Diff" lands on the diff.
- Delete `detail/PlaceShell.tsx`, `detail/PlaceBar.tsx`, `detail/Briefing.tsx`.
- New `detail/ContextRow.tsx`: button + chevron, one-line excerpt from the first
  non-empty description line, expands to `<Markdown>` in place. No border
  duplication with the detail bar or the strip.
- New `detail/ReviewBar.tsx`: the fixed column; sections as props/children so
  each phase can fill it. Owns scroll; footer stays fixed.
- `stores/ui.ts`: replace `DetailView`/`DetailIntent` with the smaller intent
  type; add `barOpen` only if D5 goes responsive; add `showDiffComments`.
- `detail/PRDetailBar.tsx`: drop `reviewState`/`checkStatus` props (state moved
  to the bar). Add the bar toggle below `wide`. Keep fullscreen, Manage, GitHub.

Acceptance: opening a PR shows detail bar → Context row → strip → diff; no
places; Escape returns the Context row to collapsed, then fullscreen, then
closes. Receipt still replaces the document for merged/closed PRs.

### Phase 2 — diff surface

Files:

- `diff/DiffView.tsx` — rewrite:
  - delete `FileRail`, `PathRail`, the separator, `useResizableRail`,
    `SemanticRail` mount (move the mount behind the Files popover if kept), and
    the `--diff-rail` CSS var;
  - one vertical scroller; files keep the expand/collapse set and first-open
    default; sticky 44px headers;
  - keep `focusTarget`, flash, `useScrollEdges`, `DiffCommentsContext`;
  - render a `ReviewFindingsContext` (Phase 3) alongside comments.
- `diff/DiffToolbar.tsx` → delete, replaced by `detail/DiffStrip.tsx`:
  - left: `N files · +A −D · C commits · ✓ checks · sha` (omit a fact when its
    value is absent/none);
  - right: inline-comments toggle, hide-cosmetic toggle, `Files` popover;
  - popover reuses the existing filter/sort/hidden-kind/path/focus controls.
- `diff/DiffFileSection.tsx`: 44px header, path (+/−) and a comment-on-file
  button; keep status/cosmetic/signals but demote to one truncated line.
- `diff/useDiffNavigation.ts`: drop rail selection, filter input ref and
  `selectFile`; keep expand/collapse, `j`/`k` over headers, focus, flash,
  scroll clamping and `focusTarget`.
- Delete `diff/DiffRail.tsx`, `DiffRailFilters.tsx`, `DiffRailList.tsx`,
  `useResizableRail.ts`; keep `diffSelection.ts` (the popover and navigation
  still use it).

Acceptance: no file rail; `j`/`k` move between file headers and open them;
`/` opens the Files popover filter; cosmetic hiding and comment toggling work;
review jumps still open the right file/hunk.

### Phase 3 — review: bar section + inline finding threads

New data plumbing. Findings already ride on `reviewController.artifact.review`;
the diff is below that controller in `PRDetail`, so pass them through context:

- New `diff/ReviewFindingsContext.ts` carrying `{ review, artifact, stale,
onApply, applying, applyFailure }`, memoized like `DiffCommentsContext`.
- `detail/ReviewSection.tsx`:
  - badge from `pr.reviewState`; author/time from the newest verdict comment
    (omit rather than invent a timestamp);
  - `ReviewVerdict` (reuse), severity strip and counts, then the index: one row
    per finding (`path:line`, severity rail, title). Clicking a row sets
    `focusTarget` and flashes the line. This is the only navigation the bar
    needs; the diff holds the text.
  - run states: idle (Start review), running (compact stages + Cancel),
    artifact (Re-run), error (message + Retry), unavailable (repoPaths note
    with the config snippet), stale (re-run note).
- New `diff/FindingThread.tsx` (derive from `FindingCard`'s expanded body):
  2px severity rail, `triage review` + severity tag + age, title, body, Apply
  patch, apply error. No Reply (D6).
- `diff/DiffPatch.tsx` + `DiffHunkRows.tsx`: group findings by
  `file` + new-side `line` and render a thread immediately after that line.
  Findings that do not land on a rendered line are not dropped: they stay in
  the bar index and their row still focuses the file.
- `review/ReviewTab.tsx`, `ReviewFindings.tsx`, `FindingGroup.tsx` delete.
  `FindingCard.tsx` shrinks to the thread body or is replaced by
  `FindingThread`; `FindingHunk.tsx` deletes (the thread sits on real code).
  `ReviewStages.tsx`, `useApplyFinding.ts`, `reviewHunks.ts` stay.
- `detail/ReviewPanel.tsx`: mount at the top of the bar (D7); ReviewPanel's
  Escape handling keeps its current priority.

Acceptance: Start review runs from the bar footer; findings render as threads on
their lines; the bar index jumps to a thread; Apply patch still reports its
worktree error; stale artifacts say so in the bar and do not anchor silently.

### Phase 4 — conversation and explanation in the bar

- `detail/Conversation.tsx`: reuse for the bar (compact list, stems the
  existing `conversationEntries`); clamp bodies to two lines; keep chronological
  order.
- `detail/ExplainPlace.tsx` → `detail/ExplainSection.tsx`: idle action, running
  text, artifact `Markdown`, stale note, error. The bar scrolls, so no inner
  scroll; cap nothing.
- Footer: one primary (`Start review` / `Re-run review`), Cancel while running;
  nothing else lights up.

Acceptance: conversation and explanation are always reachable without leaving
the diff; the Explanation artifact survives the bar collapsing below `wide`.

### Phase 5 — cleanup and docs

- Delete dead code: `DetailView` places, `DiffRail*`, `useResizableRail`,
  `Briefing*` helpers (`needsYou`, `whyEntry`, risk grouping) after confirming
  no other caller; `FindingGroup`, `ReviewFindings`, `ReviewTab`, `PlaceShell`,
  `PlaceBar`.
- `PRDetailContext` stays `{ pr, mutations, review }`; do not move the review
  artifact in — pass it as props so consumers do not re-render on stream deltas.
- Update `AGENTS.md` MVP: move "inline annotations in the Diff tab" from Out to
  In, add "one PR screen with a fixed review bar" under Architecture scope.
- Update `.skills/frontend/SKILL.md`: PR detail bullet (no places, no briefing,
  300 bar, fact ownership), diff bullet (no file rail, 44px file heads, strip,
  inline findings), review bullet (bar verdict + index + threads).
- Update `.omp/RULES.md` only if a hard rule changes (it should not).

## Tests

Rewrite by behaviour, not by source text.

- `PRDetail.test.tsx`: delete place tests; add
  - document order: detail bar → Context → strip → diff, no title;
  - Context starts collapsed, expands, Escape closes it before fullscreen;
  - Escape priority with the review form;
  - receipts for merged/closed (keep);
  - review runs from the bar and the artifact lands in the bar, not a place.
- `DiffView.test.tsx`: delete rail resize/filter-row/selection tests; keep and
  adapt comment composer, anchors, cosmetic hiding, raw fallback, focus mode,
  keyboard movement; add strip facts, files popover filter, comment toggle,
  and finding thread anchored on the right line (plus an unanchored finding
  still in the index).
- New `ReviewSection.test.tsx`: state badge and author/time derivation, counts,
  index jump token, unavailable and stale states, `Re-run`.
- New `detect`-free unit test for finding anchoring next to `reviewHunks.test`.
- Delete tests that only asserted removed markup. Do not re-pin wording.

## Verification

Per phase: `bun run fix && bun run typecheck && bun test --watch` for the touched
file, then the phase's test files.
Before handoff: `make check` and `make test`.
Visual: open the real app at 1440 and at 1180. At 1440 the document is ~544px with
the bar; at 1180 the bar is hidden and the toggle in the detail bar shows it.

## Out of scope

- Any Go/API/OpenAPI change; no `make api`.
- Publishing findings or replies to GitHub.
- List rework; the hero and buckets already match.
- Adopting the mock's 376px list width (see D5).
- Removing fullscreen (see D2).
