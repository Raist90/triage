import type { UseQueryResult } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Button } from "../../components/ui";
import { describeError } from "../../lib/api";
import { cx } from "../../lib/cx";
import type { PR, PRListResponse } from "../../lib/types";
import { scrollEdgeClass, useScrollEdges } from "../../lib/useScrollEdges";
import type { PRFilters } from "../../stores/ui";
import { PRRow } from "./PRRow";
import { usePRListCursor } from "./usePRListCursor";

type PRListBodyProps = {
  query: UseQueryResult<PRListResponse, Error>;
  /** Focus and scroll container; also the listbox while rows exist. */
  listRef: RefObject<HTMLDivElement | null>;
  visible: PR[];
  prs: PR[];
  filters: PRFilters;
  isLoading: boolean;
  tabID: string;
  tabLabel: string;
  repo: string | null;
  scope: string;
  selectedPR: string | null;
  onPick: (pr: PR) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  onOpenSearch: () => void;
  onToggleFilters: () => void;
  onCloseFilters: () => void;
  onClearSelection: () => void;
};

const optionId = (index: number) => `pr-option-${index}`;

/**
 * How long the cursor must rest before a keyboard move opens its row. Holding
 * j/k repeats the key, so opening on every move would read every skipped pull
 * request from GitHub.
 */
const OPEN_DELAY_MS = 150;

/**
 * The list viewport. It stays mounted across loading, error and empty answers,
 * so the keyboard surface survives a filter that removes every row.
 */
export function PRListBody({
  query,
  listRef,
  visible,
  prs,
  filters,
  isLoading,
  tabID,
  tabLabel,
  repo,
  scope,
  selectedPR,
  onPick,
  onRetry,
  onClearFilters,
  onOpenSearch,
  onToggleFilters,
  onCloseFilters,
  onClearSelection,
}: PRListBodyProps) {
  const scrollEdges = useScrollEdges(listRef);
  // Only rendered rows are keyboard-reachable: placeholder data and the rows
  // retained behind an error must not be pickable.
  const rows = isLoading || query.isError ? [] : visible;
  const hasRows = rows.length > 0;

  // The cursor moves on every key repeat, but opening each row would fetch its
  // detail. Highlight the row under the cursor immediately (`pending`) and open
  // it once the cursor rests; a click still opens immediately.
  const [pending, setPending] = useState<string | null>(null);
  const openTimer = useRef<number | null>(null);

  const cancelOpen = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);

  useEffect(() => cancelOpen, [cancelOpen]);

  const openNow = useCallback(
    (pr: PR) => {
      cancelOpen();
      // The click commits the selection synchronously, so it needs no preview.
      setPending(null);
      onPick(pr);
    },
    [cancelOpen, onPick],
  );

  const openSoon = useCallback(
    (pr: PR) => {
      cancelOpen();
      setPending(`${pr.repo}#${pr.number}`);
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null;
        setPending(null);
        onPick(pr);
      }, OPEN_DELAY_MS);
    },
    [cancelOpen, onPick],
  );

  const selectedIndex = rows.findIndex(
    (pr) => `${pr.repo}#${pr.number}` === selectedPR,
  );

  const { cursor, handleKeyDown } = usePRListCursor({
    count: rows.length,
    selectedIndex,
    scrollRef: listRef,
    onPick: (index) => {
      const pr = rows[index];
      if (pr) openSoon(pr);
    },
    onSearch: onOpenSearch,
    onToggleFilters,
    onDismiss: () => {
      cancelOpen();
      setPending(null);
      onCloseFilters();
      onClearSelection();
    },
  });

  // Returning from the detail panel restores keyboard focus to the list.
  useEffect(() => {
    if (!selectedPR) listRef.current?.focus();
  }, [selectedPR, listRef]);

  return (
    <div
      ref={listRef}
      role={hasRows ? "listbox" : "group"}
      aria-label={`${tabLabel} pull requests`}
      aria-activedescendant={hasRows ? optionId(cursor) : undefined}
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
      ) : prs.length === 0 ? (
        <EmptyState
          title={`No pull requests in ${tabLabel}`}
          description={`Nothing open in ${scope}.`}
          footnote="Refresh pulls fresh data from GitHub."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No pull requests match"
          description={
            filters.query
              ? `Nothing matches “${filters.query}” in ${scope}.`
              : `No open pull requests match the current filters in ${scope}.`
          }
          footnote="Press / to search, f to change filters."
          action={
            <Button variant="outline" onClick={onClearFilters} className="mt-1">
              Clear filters
            </Button>
          }
        />
      ) : (
        rows.map((pr, index) => (
          <PRRow
            key={`${pr.repo}#${pr.number}`}
            optionId={optionId(index)}
            pr={pr}
            active={index === cursor}
            selected={(pending ?? selectedPR) === `${pr.repo}#${pr.number}`}
            showRepo={repo === null}
            showAuthor={tabID !== "mine"}
            onPick={() => openNow(pr)}
          />
        ))
      )}
    </div>
  );
}
