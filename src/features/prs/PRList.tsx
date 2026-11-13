import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ListFilter, RefreshCw, Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { EmptyState } from "../../components/EmptyState";
import { Button, IconButton } from "../../components/ui";
import { describeError, getPRs } from "../../lib/api";
import { useUIStore } from "../../stores/ui";
import { PRFilterPopover } from "./PRFilterPopover";
import { PRRow } from "./PRRow";
import {
  filterChips,
  filterPRs,
  hasFacetFilters,
  sortPRs,
  type FilterChip,
} from "./prFilters";

type PRListProps = {
  tabID: string;
  tabLabel: string;
  repo: string | null;
};

export function PRList({ tabID, tabLabel, repo }: PRListProps) {
  const queryClient = useQueryClient();
  const queryKey = ["prs", repo, tabID] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => getPRs({ tab: tabID, repo }),
    placeholderData: keepPreviousData,
  });

  const prs = useMemo(() => query.data?.prs ?? [], [query.data]);

  const filters = useUIStore((state) => state.prFilters);
  const setFilterQuery = useUIStore((state) => state.setFilterQuery);
  const toggleFilterFacet = useUIStore((state) => state.toggleFilterFacet);
  const setFilterFacet = useUIStore((state) => state.setFilterFacet);
  const toggleHideDrafts = useUIStore((state) => state.toggleHideDrafts);
  const clearPRFilters = useUIStore((state) => state.clearPRFilters);

  const visible = useMemo(
    () => sortPRs(filterPRs(prs, filters)),
    [prs, filters],
  );
  const chips = useMemo(() => filterChips(prs, filters), [prs, filters]);
  const lastIndex = Math.max(visible.length - 1, 0);

  // Placeholder rows from the previous query key are not fresh for this tab.
  const isLoading = query.isPending || query.isPlaceholderData;

  const [cursorState, setCursorState] = useState(0);
  // A shorter list after a refetch or filter change must not leave the cursor
  // out of bounds.
  const cursor = Math.min(cursorState, lastIndex);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

  const selectedPR = useUIStore((state) => state.selectedPR);
  const selectPR = useUIStore((state) => state.selectPR);

  // Returning from the detail panel restores keyboard focus to the list.
  useEffect(() => {
    if (!selectedPR) listRef.current?.focus();
  }, [selectedPR]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // A click anywhere outside the filter button and its panel dismisses it.
  useEffect(() => {
    if (!filtersOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (
        filterRef.current &&
        event.target instanceof Node &&
        !filterRef.current.contains(event.target)
      ) {
        setFiltersOpen(false);
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [filtersOpen]);

  function moveCursor(index: number) {
    const next = Math.min(Math.max(index, 0), lastIndex);
    setCursorState(next);
    rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
  }

  function pick(index: number) {
    const pr = visible[index];
    if (!pr) return;
    selectPR(`${pr.repo}#${pr.number}`);
  }

  function clearAllFilters() {
    clearPRFilters();
    setFilterQuery("");
  }

  function removeChip(chip: FilterChip) {
    if (chip.section === "drafts") {
      toggleHideDrafts();
      return;
    }
    if (chip.clearSection) {
      setFilterFacet(chip.section, []);
      return;
    }
    toggleFilterFacet(chip.section, chip.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "j":
      case "ArrowDown":
        event.preventDefault();
        moveCursor(cursor + 1);
        break;
      case "k":
      case "ArrowUp":
        event.preventDefault();
        moveCursor(cursor - 1);
        break;
      case "Enter":
        event.preventDefault();
        pick(cursor);
        break;
      case "Escape":
        event.preventDefault();
        setFiltersOpen(false);
        selectPR(null);
        break;
      case "/":
        event.preventDefault();
        setSearchOpen(true);
        break;
      case "f":
        event.preventDefault();
        setFiltersOpen((open) => !open);
        break;
      default:
        break;
    }
  }

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const data = await getPRs({ tab: tabID, repo, refresh: true });
      queryClient.setQueryData(queryKey, data);
    } catch (error) {
      setRefreshError(describeError(error));
    } finally {
      setRefreshing(false);
    }
  }

  const scope = repo ?? "All repos";
  const isFiltered = visible.length !== prs.length || filters.query !== "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line pr-1 pl-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-meta font-medium text-fg">
            {tabLabel}
          </span>
          {searchOpen ? null : (
            <>
              <span className="shrink-0 text-fg-faint" aria-hidden="true">
                ·
              </span>
              <span className="tabular shrink-0 text-meta text-fg-faint">
                {isLoading
                  ? "Loading…"
                  : isFiltered
                    ? `${visible.length} of ${prs.length}`
                    : `${prs.length} open`}
              </span>
              <span className="h-3 w-px shrink-0 bg-line" aria-hidden="true" />
            </>
          )}
          {searchOpen ? (
            <label className="relative block min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2 text-fg-faint"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="text"
                value={filters.query}
                onChange={(event) => setFilterQuery(event.target.value)}
                onBlur={() => {
                  if (filters.query.trim() === "") setSearchOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (filters.query) {
                    setFilterQuery("");
                  } else {
                    setSearchOpen(false);
                    listRef.current?.focus();
                  }
                }}
                placeholder="Search pull requests"
                aria-label="Search pull requests"
                className="h-7 w-full rounded-[4px] border border-line bg-surface pr-7 pl-7 text-meta text-fg placeholder:text-fg-faint focus:border-line-strong focus:outline-none"
              />
              {filters.query ? (
                <button
                  type="button"
                  onClick={() => setFilterQuery("")}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-[3px] text-fg-faint transition-colors hover:text-fg"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title="Search pull requests (/)"
              className="min-w-0 truncate text-left font-mono text-meta text-fg-faint transition-colors hover:text-fg"
            >
              {filters.query ? (
                <span className="text-fg-body">“{filters.query}”</span>
              ) : (
                scope
              )}
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div ref={filterRef} className="relative">
            <IconButton
              label="Filter pull requests (f)"
              active={filtersOpen || hasFacetFilters(filters)}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <ListFilter className="size-4" aria-hidden />
            </IconButton>
            {filtersOpen ? (
              <PRFilterPopover
                prs={prs}
                filters={filters}
                showRepos={repo === null}
                shown={visible.length}
                total={prs.length}
                onToggleFacet={toggleFilterFacet}
                onSetFacet={setFilterFacet}
                onToggleDrafts={toggleHideDrafts}
                onClear={clearAllFilters}
                onClose={() => setFiltersOpen(false)}
              />
            ) : null}
          </div>

          <IconButton
            label="Refresh from GitHub"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden
            />
          </IconButton>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => removeChip(chip)}
                aria-label={`Remove filter: ${chip.label}`}
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[4px] border border-line px-1.5 text-meta text-fg-body transition-colors hover:border-line-strong hover:text-fg"
              >
                <span
                  className={
                    chip.section === "authors" || chip.section === "repos"
                      ? "font-mono"
                      : undefined
                  }
                >
                  {chip.label}
                </span>
                <X className="size-3 text-fg-faint" aria-hidden />
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            onClick={clearPRFilters}
            className="shrink-0 px-1.5 text-micro tracking-[0.08em] text-fg-faint uppercase hover:bg-transparent hover:text-fg"
          >
            Clear
          </Button>
        </div>
      ) : null}

      {refreshError ? (
        <p
          role="alert"
          className="border-b border-line px-3 py-2 text-meta text-fg-muted"
        >
          {refreshError}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && !query.isError ? (
          <div aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="flex h-[52px] flex-col justify-center gap-2 border-b border-line px-3"
              >
                <div className="h-3 w-2/3 animate-pulse rounded-[4px] bg-surface" />
                <div className="h-2.5 w-1/3 animate-pulse rounded-[4px] bg-surface" />
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <div
            role="alert"
            className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"
          >
            <p className="text-ui text-fg">Can’t load pull requests</p>
            <p className="max-w-sm text-meta text-fg-faint">
              {describeError(query.error)}
            </p>
            <Button
              variant="outline"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="mt-1"
            >
              {query.isFetching ? "Retrying…" : "Retry"}
            </Button>
          </div>
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
              <Button
                variant="outline"
                onClick={clearAllFilters}
                className="mt-1"
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div
            ref={listRef}
            role="listbox"
            aria-label={`${tabLabel} pull requests`}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="outline-none"
          >
            {visible.map((pr, index) => (
              <PRRow
                key={`${pr.repo}#${pr.number}`}
                pr={pr}
                active={index === cursor}
                selected={selectedPR === `${pr.repo}#${pr.number}`}
                onPick={() => pick(index)}
                elementRef={(element) => {
                  rowRefs.current[index] = element;
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
