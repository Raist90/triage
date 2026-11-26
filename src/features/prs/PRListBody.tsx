import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState, type RefObject } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Button, MicroLabel } from "../../components/ui";
import { describeError } from "../../lib/api";
import { cx } from "../../lib/cx";
import type { PR, PRListResponse } from "../../lib/types";
import { scrollEdgeClass, useScrollEdges } from "../../lib/useScrollEdges";
import { useUIStore, type PRFilters } from "../../stores/ui";
import { DeckHero } from "./DeckHero";
import { DeckRow } from "./DeckRow";
import { DraftRow } from "./DraftRow";
import { prKey, type Deck, type DeckBucketID } from "./deck";
import { usePRListCursor } from "./usePRListCursor";

type PRListBodyProps = {
  query: UseQueryResult<PRListResponse, Error>;
  /** Focus and scroll container; also the listbox while rows exist. */
  listRef: RefObject<HTMLDivElement | null>;
  deck: Deck;
  prsCount: number;
  visibleCount: number;
  filters: PRFilters;
  isLoading: boolean;
  tabID: string;
  tabLabel: string;
  repo: string | null;
  selectedPR: string | null;
  onPick: (pr: PR) => void;
  onOpenDiff: (pr: PR) => void;
  onSkip: (pr: PR) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  onOpenSearch: () => void;
  onToggleFilters: () => void;
  onCloseFilters: () => void;
  onClearSelection: () => void;
};

const optionID = (key: string) =>
  `pr-option-${key.replace(/[^A-Za-z0-9_-]+/g, "-")}`;

/**
 * The deck viewport. It stays mounted across loading, error and empty answers,
 * so the keyboard surface survives a filter that removes every row.
 */
export function PRListBody({
  query,
  listRef,
  deck,
  prsCount,
  visibleCount,
  filters,
  isLoading,
  tabID,
  tabLabel,
  repo,
  selectedPR,
  onPick,
  onOpenDiff,
  onSkip,
  onRetry,
  onClearFilters,
  onOpenSearch,
  onToggleFilters,
  onCloseFilters,
  onClearSelection,
}: PRListBodyProps) {
  const scrollEdges = useScrollEdges(listRef);
  const live = !isLoading && !query.isError && visibleCount > 0;

  // Collapse is local and session-only; the list remounts on tab/repo change.
  const [collapsed, setCollapsed] = useState<
    Partial<Record<DeckBucketID, boolean>>
  >({});
  const toggleBucket = useCallback((id: DeckBucketID) => {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const rows = live
    ? deck.rows.filter((row) => row.bucket === null || !collapsed[row.bucket])
    : [];
  const keys = rows.map((row) => prKey(row.pr));
  const byKey = new Map(rows.map((row) => [prKey(row.pr), row.pr]));

  const { cursorKey, handleKeyDown } = usePRListCursor({
    keys,
    selectedKey: selectedPR,
    scrollRef: listRef,
    optionID,
    onOpen: (key) => {
      const pr = byKey.get(key);
      if (pr) onPick(pr);
    },
    onSearch: onOpenSearch,
    onToggleFilters,
    onDismiss: () => {
      onCloseFilters();
      onClearSelection();
    },
  });

  // Returning from the detail panel restores keyboard focus to the list, so
  // Enter can reopen the selected row.
  const detailOpen = useUIStore((state) => state.detailOpen);
  useEffect(() => {
    if (!detailOpen) listRef.current?.focus();
  }, [detailOpen, listRef]);

  return (
    <div
      ref={listRef}
      role={rows.length > 0 ? "listbox" : "group"}
      aria-label={`${tabLabel} pull requests`}
      aria-activedescendant={
        rows.length > 0 && cursorKey ? optionID(cursorKey) : undefined
      }
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cx(
        "min-h-0 flex-1 overflow-y-auto outline-none",
        scrollEdgeClass(scrollEdges),
      )}
    >
      {isLoading && !query.isError ? (
        <div aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="flex h-13 flex-col justify-center gap-2 border-b border-line px-3"
            >
              <div className="h-3 w-2/3 shimmer rounded-sm" />
              <div className="h-2.5 w-1/3 shimmer rounded-sm" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title="Can’t load pull requests"
          message={describeError(query.error)}
          retrying={query.isFetching}
          onRetry={onRetry}
        />
      ) : prsCount === 0 ? (
        <EmptyState
          title={`No pull requests in ${tabLabel}`}
          description={`Nothing open in ${repo ?? "All repos"}.`}
          footnote="Refresh pulls fresh data from GitHub."
        />
      ) : visibleCount === 0 ? (
        <EmptyState
          title="No pull requests match"
          description={
            filters.query
              ? `Nothing matches “${filters.query}” in ${repo ?? "All repos"}.`
              : `No open pull requests match the current filters in ${repo ?? "All repos"}.`
          }
          footnote="Press / to search, f to change filters."
          action={
            <Button variant="outline" onClick={onClearFilters} className="mt-1">
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          {deck.hero ? (
            <DeckHero
              pr={deck.hero}
              kind={deck.heroKind === "draft" ? "draft" : "ready"}
              optionId={optionID(prKey(deck.hero))}
              cursor={cursorKey === prKey(deck.hero)}
              selected={selectedPR === prKey(deck.hero)}
              onOpenPR={() => onPick(deck.hero as PR)}
              onOpenDiff={() => onOpenDiff(deck.hero as PR)}
              onSkip={() => onSkip(deck.hero as PR)}
            />
          ) : null}

          {deck.buckets.map((bucket) => {
            const isCollapsed = collapsed[bucket.id] === true;
            return (
              <section key={bucket.id} className="px-2 pb-1">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleBucket(bucket.id)}
                  className="flex w-full items-center gap-2 border-t border-line px-1 pt-2 pb-1.5 text-left"
                >
                  <MicroLabel className="text-fg-muted">
                    {bucket.label}
                  </MicroLabel>
                  <span className="inline-flex h-3.5 items-center rounded-[3px] bg-fg/5 px-1 font-mono text-micro text-fg-faint tabular-nums">
                    {bucket.rows.length}
                  </span>
                  <ChevronDown
                    className={cx(
                      "ml-auto size-3.5 text-fg-faint transition-transform",
                      isCollapsed && "-rotate-90",
                    )}
                    aria-hidden
                  />
                </button>

                {isCollapsed ? null : (
                  <div className="flex flex-col">
                    {bucket.rows.map((pr) =>
                      bucket.id === "drafts" ? (
                        <DraftRow
                          key={prKey(pr)}
                          pr={pr}
                          optionId={optionID(prKey(pr))}
                          cursor={cursorKey === prKey(pr)}
                          selected={selectedPR === prKey(pr)}
                          onPick={() => onPick(pr)}
                        />
                      ) : (
                        <DeckRow
                          key={prKey(pr)}
                          pr={pr}
                          optionId={optionID(prKey(pr))}
                          cursor={cursorKey === prKey(pr)}
                          selected={selectedPR === prKey(pr)}
                          tab={tabID}
                          bucket={bucket.id}
                          showRepo={repo === null}
                          onPick={() => onPick(pr)}
                        />
                      ),
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
