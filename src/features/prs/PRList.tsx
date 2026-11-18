import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { describeError, getPRs } from "../../lib/api";
import { useLiveRefresh } from "../../lib/liveRefresh";
import { refreshOpenPR, syncPRHead } from "../../lib/prRefresh";
import type { PR } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { PRFilterChips } from "./PRFilterChips";
import { PRListBody } from "./PRListBody";
import { PRListToolbar } from "./PRListToolbar";
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

type RefreshFailure = {
  message: string;
  /** The list's dataUpdatedAt when the manual refresh failed. */
  listDataAt: number;
};

export function PRList({ tabID, tabLabel, repo }: PRListProps) {
  const queryClient = useQueryClient();
  const queryKey = ["prs", repo, tabID] as const;

  // A live re-read is meant to see GitHub's current answer, not the server's
  // cached one, so the next fetch bypasses the TTLs by reading this flag.
  const liveRefetch = useRef(false);
  const query = useQuery({
    queryKey,
    queryFn: () => {
      const refresh = liveRefetch.current;
      liveRefetch.current = false;
      return getPRs({ tab: tabID, repo, refresh });
    },
    placeholderData: keepPreviousData,
  });

  // The visible list is the only list worth refreshing; the hook pauses it when
  // the window is not focused and backs off while GitHub reports no change.
  // Fullscreen hides the list without unmounting it, so its polls stop too.
  const detailFullscreen = useUIStore((state) => state.detailFullscreen);
  useLiveRefresh(!detailFullscreen, query.data, query.refetch, () => {
    liveRefetch.current = true;
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

  // Placeholder rows from the previous query key are not fresh for this tab.
  const isLoading = query.isPending || query.isPlaceholderData;

  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState<RefreshFailure | null>(
    null,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectedPR = useUIStore((state) => state.selectedPR);
  const detailOpen = useUIStore((state) => state.detailOpen);
  const selectPR = useUIStore((state) => state.selectPR);

  const scope = repo ?? "All repos";
  const isFiltered = hasFacetFilters(filters) || filters.query.trim() !== "";

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const toggleFilters = useCallback(() => setFiltersOpen((open) => !open), []);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const focusList = useCallback(() => listRef.current?.focus(), [listRef]);

  // A failed manual refresh is stale as soon as any later read answers.
  const refreshError =
    refreshFailure && refreshFailure.listDataAt === query.dataUpdatedAt
      ? refreshFailure.message
      : null;

  function pickPR(pr: PR) {
    selectPR(`${pr.repo}#${pr.number}`);
    // The list row carries the fresh head; a cached detail from an older
    // commit is re-read instead of being shown as current.
    void syncPRHead(queryClient, pr).catch(() => {});
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

  async function refresh() {
    setRefreshing(true);
    setRefreshFailure(null);
    try {
      const data = await getPRs({ tab: tabID, repo, refresh: true });
      queryClient.setQueryData(queryKey, data);
      const open = selectedPR
        ? data.prs.find((item) => `${item.repo}#${item.number}` === selectedPR)
        : undefined;
      if (open && detailOpen) {
        // The list bypassed its cache; the open detail and diff must too.
        await refreshOpenPR(queryClient, open.repo, open.number);
      }
    } catch (error) {
      setRefreshFailure({
        message: describeError(error),
        listDataAt: query.dataUpdatedAt,
      });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PRListToolbar
        tabLabel={tabLabel}
        isLoading={isLoading}
        isFiltered={isFiltered}
        shown={visible.length}
        total={prs.length}
        repo={repo}
        prs={prs}
        filters={filters}
        searchOpen={searchOpen}
        filtersOpen={filtersOpen}
        refreshing={refreshing}
        onOpenSearch={openSearch}
        onCloseSearch={closeSearch}
        onFocusList={focusList}
        onSetQuery={setFilterQuery}
        onToggleFilters={toggleFilters}
        onCloseFilters={closeFilters}
        onRefresh={() => void refresh()}
        onToggleFacet={toggleFilterFacet}
        onSetFacet={setFilterFacet}
        onToggleDrafts={toggleHideDrafts}
        onClearFilters={clearAllFilters}
      />

      <PRFilterChips
        chips={chips}
        onRemove={removeChip}
        onClear={clearPRFilters}
      />

      {refreshError ? (
        <p
          role="alert"
          className="border-b border-line px-3 py-2 text-meta text-fg-muted"
        >
          {refreshError}
        </p>
      ) : null}

      <PRListBody
        query={query}
        listRef={listRef}
        visible={visible}
        prs={prs}
        filters={filters}
        isLoading={isLoading}
        tabID={tabID}
        tabLabel={tabLabel}
        repo={repo}
        scope={scope}
        selectedPR={selectedPR}
        onPick={pickPR}
        onRetry={() => void query.refetch()}
        onClearFilters={clearAllFilters}
        onOpenSearch={openSearch}
        onToggleFilters={toggleFilters}
        onCloseFilters={closeFilters}
        onClearSelection={() => selectPR(null)}
      />
    </div>
  );
}
