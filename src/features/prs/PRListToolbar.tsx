import { ListFilter, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "../../components/ui";
import type { PR } from "../../lib/types";
import type { PRFilterSection, PRFilters } from "../../stores/ui";
import { PRFilterPopover } from "./PRFilterPopover";
import { hasFacetFilters } from "./prFilters";

type PRListToolbarProps = {
  tabLabel: string;
  isLoading: boolean;
  isFiltered: boolean;
  shown: number;
  total: number;
  repo: string | null;
  prs: PR[];
  filters: PRFilters;
  searchOpen: boolean;
  filtersOpen: boolean;
  refreshing: boolean;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onFocusList: () => void;
  onSetQuery: (query: string) => void;
  onToggleFilters: () => void;
  onCloseFilters: () => void;
  onRefresh: () => void;
  onToggleFacet: (section: PRFilterSection, value: string) => void;
  onSetFacet: (section: PRFilterSection, values: string[]) => void;
  onToggleDrafts: () => void;
  onClearFilters: () => void;
};

/** The 44px list band: identity, search, facet filters and manual refresh. */
export function PRListToolbar({
  tabLabel,
  isLoading,
  isFiltered,
  shown,
  total,
  repo,
  prs,
  filters,
  searchOpen,
  filtersOpen,
  refreshing,
  onOpenSearch,
  onCloseSearch,
  onFocusList,
  onSetQuery,
  onToggleFilters,
  onCloseFilters,
  onRefresh,
  onToggleFacet,
  onSetFacet,
  onToggleDrafts,
  onClearFilters,
}: PRListToolbarProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const filterRef = useRef<HTMLDivElement | null>(null);

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
        onCloseFilters();
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [filtersOpen, onCloseFilters]);

  return (
    <div
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center justify-between gap-2 pr-1"
      style={{ paddingLeft: "max(0.75rem, var(--chrome-lead, 0px))" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-meta font-medium text-fg">
          {tabLabel}
        </span>
        {searchOpen ? null : (
          <>
            <span className="shrink-0 text-fg-faint" aria-hidden="true">
              ·
            </span>
            <span className="shrink-0 text-meta text-fg-faint tabular-nums">
              {isLoading
                ? "Loading…"
                : isFiltered
                  ? `${shown} of ${total}`
                  : `${total} open`}
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
              onChange={(event) => onSetQuery(event.target.value)}
              onBlur={() => {
                if (filters.query.trim() === "") onCloseSearch();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                if (filters.query) {
                  onSetQuery("");
                } else {
                  onCloseSearch();
                  onFocusList();
                }
              }}
              placeholder="Search pull requests"
              aria-label="Search pull requests"
              className="h-7 w-full rounded-sm border border-line bg-surface px-7 text-meta text-fg placeholder:text-fg-faint focus:border-line-strong focus:outline-none"
            />
            {filters.query ? (
              <button
                type="button"
                onClick={() => onSetQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-fg-faint transition-colors hover:text-fg"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </label>
        ) : (
          <button
            type="button"
            onClick={onOpenSearch}
            title="Search pull requests (/)"
            className="min-w-0 truncate text-left text-meta text-fg-faint transition-colors hover:text-fg"
          >
            {filters.query ? (
              <span className="text-fg-body">“{filters.query}”</span>
            ) : (
              "Search"
            )}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <div ref={filterRef} className="relative">
          <IconButton
            label="Filter pull requests (f)"
            active={filtersOpen || hasFacetFilters(filters)}
            onClick={onToggleFilters}
          >
            <ListFilter className="size-4" aria-hidden />
          </IconButton>
          {filtersOpen ? (
            <PRFilterPopover
              prs={prs}
              filters={filters}
              showRepos={repo === null}
              shown={shown}
              total={total}
              onToggleFacet={onToggleFacet}
              onSetFacet={onSetFacet}
              onToggleDrafts={onToggleDrafts}
              onClear={onClearFilters}
              onClose={onCloseFilters}
            />
          ) : null}
        </div>

        <IconButton
          label="Refresh from GitHub"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={`size-4 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden
          />
        </IconButton>
      </div>
    </div>
  );
}
