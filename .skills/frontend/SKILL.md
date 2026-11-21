---
name: frontend
description: Use when editing React/TypeScript UI under src/ — Tailwind theme tokens and color roles, the six-size type scale, Geist fonts, gradients, spacing and chrome sizes, pane layout and fullscreen, diff rendering, and TanStack Query / Zustand / src/lib/api.ts data-flow conventions. Also use for src/index.css theme changes.
---

# Frontend

Applies to `src/` (React webview). The Rust in `src-tauri/` is thin glue; see
`backend` for anything that crosses the HTTP contract.

## UI rules

Dark, quiet cockpit. Dense, aligned, low-chrome. The PR list and the PR detail
stay side by side; reviewing is the only flow that matters.

- **Type: Geist Sans + Geist Mono** (`src/index.css`, bundled woff2, OFL). Use the
  six-size scale only: `text-micro` 10, `text-meta` 12, `text-ui` 13,
  `text-prose` 14, `text-lead` 16, `text-title` 20, plus `text-code` 12/20.
  Weights are 400 and 500 only. `text-sm`/`text-xs`/`text-2xs` are gone.
  `text-micro` is for labels and state tags only: 0.08em tracking for labels,
  0.06em for tags. Actions and values use `text-meta`, except dense metadata
  inside the diff rail.
- **Mono = identity data.** Branch, repo, PR number, SHA, counts, file paths,
  timestamps use `font-mono` + `tabular-nums`. Prose and UI labels stay sans. Mono
  disables ligatures (`font-variant-ligatures: none` in `index.css`); they
  break diff span boundaries and are never useful in identity data.
- **Color roles, not shades.** Use `canvas`, `surface`, `raised`, `line`,
  `line-strong`, `fg`, `fg-body`, `fg-muted`, `fg-faint` from `@theme`. Never
  hardcode `zinc-*` in components, never use opacity variants on text.
- **Accent: one green** (`accent`) for active rail, selection rails, dots,
  primary action, focus. **Danger red** is semantic only: failing checks and
  deletions. No other hues in chrome. Status color marks exceptions and
  decisions, not defaults: passing checks and pending states stay neutral,
  accent is an approval or the next action, danger is a failure.
- **Gradients are light, not fills.** One source, top-left. Use the utilities in
  `index.css`: `ambient-wash` (shell), `app-seam` (the one fading chrome
  hairline), `header-wash` (pane header lamp), `accent-hairline` (active tab or
  icon underline), `lit`/`rail-active` (raised chrome), `row-selected`
  (list selection), `elevated` (dialogs, popovers), `cta` (the one lit action),
  `shimmer`, `live-dot`, `dot-grid`, `fade-*` (scroll edges). Never inline an
  arbitrary gradient, never add a hue, never blur.
- **Spacing: 4 / 8 / 12 / 16 / 24 / 32 only.** No `py-1.5`, `py-2.5`, `gap-3.5`,
  `px-5`. Chrome heights: one 44 top band (rail, repo panel, list toolbar,
  detail bar), 52 list row. Widths: 48 rail,
  208 repo panel, 340 PR list, 272 context rail.
- **Radii:** `rounded-sm` controls (4px), `rounded-md` dialog (6px). Both are
  declared in px in `@theme` so ESLint maps a `rounded-[4px]` back to the token.
  One focus ring (`accent` at 45%) from
  `index.css`; do not re-style focus per component.
- **Shell:** 48px rail holds the config-driven tabs (icon + tooltip, fallback
  icon for unknown IDs) and Settings. Then the repo panel, PR list, and detail.
  Detail is a sibling pane, never a route. Below `cockpit` (1180px) the detail
  covers the list. The list stays mounted so cursor and scroll survive.
  Pane boundaries are solid 1px `line` borders; only the top chrome seam fades.
  Row-like hovers use `surface/60`; controls fill with `surface`.
- **Fullscreen:** toggled only by the icon button in the 44px detail bar, no key
  binding. It hides the rail, repo panel and PR list; the list is hidden, not
  unmounted, so leaving fullscreen restores its cursor and scroll. The context
  rail keeps its normal rules and the main pane gets the full width.
- **No card soup.** Prose, comments and metadata use one surface plus 1px
  `border-line` rules. Only the diff and dialogs get a box.
- **PR rows:** one strong title line and one quiet identity line. Repo appears
  only when the list spans repositories, author only when the list is not your
  own PRs, and draft is a quiet 10px marker. Status icons mark exceptions, not
  a green column of passing checks.
- **States:** one `StateView` renders every empty, error and placeholder pane:
  icon, 16px title, 13px description, optional mono footnote, action and key
  hints. Panes never hand-roll their own empty markup.
- **Review:** the verdict is the headline (`text-lead`, accent or danger),
  followed by a proportional severity strip; every finding card carries a 2px
  severity rail.
- **PR detail:** compact header with title, state, author, branches and change
  stats; 44px bar; tabs for Conversation (default), Diff, Review (when
  available), Explain (when available). Conversation is one chronological
  timeline: the PR
  body first, then comments, review verdicts and inline review comments. The
  272px context rail shows checks, review, complexity and commit; it is hidden
  below 1400px and while the Diff tab is active (the diff needs the width).
- **Diffs:** per file, collapsible, full width, 208px file rail, draggable
  between 168 and 440px (double-click resets). Semantic diff
  via `sem` when available; fall back to a plain unified diff. Never fail a
  review flow because `sem` is absent. Semantic changes live in a 40px map on
  the right edge of the diff pane (toolbar toggle) plus a per-hunk chip that
  opens the entity rows on demand; never as always-on rows above the code.
  Code is syntax-highlighted by the Go sidecar (Chroma): colored, but only
  desaturated `syn-*` tokens from `index.css`, never raw hues in components.
  Chrome stays hue-free.
- **Icons:** `lucide-react`, 14–16px. Reuse `Button`, `IconButton`, `MicroLabel`,
  `Kbd` from `src/components/ui.tsx`; do not paste new button class strings.
- **Components:** no styling frameworks, no shadcn/Radix, no CSS-in-JS, no CSS
  files other than `src/index.css`. Build primitives by hand.
  [Base UI](https://base-ui.com) is the only exception and only for accessible
  widgets (dialog, popover, menu, tooltip) when hand-rolling one is genuinely
  risky — always headless and styled by us.
- Keyboard-first where cheap: `j`/`k` move the list cursor and open that pull
  request, `Esc` closes. Do not build a command palette until the core flow
  works.

## Frontend conventions

- TypeScript strict. No `any`; use `unknown` + narrowing at API boundaries.
- All server data through TanStack Query. Query keys are tuples
  (`["prs", repo, tab]`, `["pr", repo, number]`). Mutations invalidate precisely.
- Zustand only for ephemeral UI state (selected repo, active tab, toggles).
  Never duplicate server data into a store.
- API calls live in `src/lib/api.ts`; components never `fetch` directly.
- Types come from the generated contract. `src/lib/types.ts` re-exports them
  under the names the app uses and keeps only what OpenAPI cannot express, such
  as `ActionStreamEvent`. Never hand-write a response shape; change the Go type
  and run `make api`. Never edit `src/lib/generated` by hand.
- Components: named exports, one component per file, props typed inline or with a
  local `type`. Semantic HTML first.
- Tailwind classes sorted by ESLint and Prettier; do not hand-order them.
- Class strings are checked by `eslint-plugin-tailwindcss` against
  `src/index.css` (`settings.tailwindcss.cssConfigPath`). It enforces class order,
  canonical spelling (`size-7`, not `h-7 w-7`), shorthand, non-conflicting and
  non-negative-arbitrary classes, and it flags arbitrary values that a spacing
  utility already covers (`w-85`, not `w-[340px]`). `cx` is registered as a
  parsed function. It reads JSX attributes and function calls only, so class
  strings in plain module constants are unchecked. `bun run fix` applies the
  fixes.

## Verification

`bun run fix`, `bun run typecheck`, `bun run test`. Lint results are cached in
`node_modules/.cache/eslint`, and the cache does not track `src/index.css`,
which the Tailwind rules read — run `make clean` after editing theme tokens if a
class warning looks stale (`make check` drops the cache when the CSS is newer).

Tests use Bun's runner with happy-dom and Testing Library. `src/test/setup.ts`
registers the DOM; `src/test/fixtures.ts` builds contract objects. Test
behavior, not source text, and mock `src/lib/api` per file when a component
fetches data.
