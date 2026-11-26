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
  type FilterChip,
} from "./prFilters";
import { buildDeck, prKey } from "./deck";

type PRListProps = {
  tabID: string;
  tabLabel: string;
  repo: string | null;
};

const EMPTY_SKIPPED: ReadonlySet<string> = new Set();

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
  const viewer = query.data?.viewer.login ?? "";

  const filters = useUIStore((state) => state.prFilters);
  const setFilterQuery = useUIStore((state) => state.setFilterQuery);
  const toggleFilterFacet = useUIStore((state) => state.toggleFilterFacet);
  const setFilterFacet = useUIStore((state) => state.setFilterFacet);
  const toggleHideDrafts = useUIStore((state) => state.toggleHideDrafts);
  const clearPRFilters = useUIStore((state) => state.clearPRFilters);

  const visible = useMemo(() => filterPRs(prs, filters), [prs, filters]);
  // Skip is session-only and scoped to this list mount. Keying the state by
  // tab/repo makes a change reset it without an effect.
  const scopeKey = `${tabID}:${repo ?? ""}`;
  const [skipState, setSkipState] = useState<{
    scope: string;
    keys: ReadonlySet<string>;
  }>({ scope: scopeKey, keys: new Set() });
  const skipped = skipState.scope === scopeKey ? skipState.keys : EMPTY_SKIPPED;
  const deck = useMemo(
    () => buildDeck(visible, tabID, viewer, skipped),
    [visible, tabID, viewer, skipped],
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
  const setDetailIntent = useUIStore((state) => state.setDetailIntent);

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
    selectPR(prKey(pr));
    // A row click always lands on Preflight, even when the same PR is already
    // open on another tab.
    setDetailIntent({
      prKey: prKey(pr),
      tab: "preflight",
      token: Date.now(),
    });
    // The list row carries the fresh head; a cached detail from an older
    // commit is re-read instead of being shown as current.
    void syncPRHead(queryClient, pr).catch(() => {});
  }

  function openDiff(pr: PR) {
    selectPR(prKey(pr));
    setDetailIntent({ prKey: prKey(pr), tab: "diff", token: Date.now() });
    void syncPRHead(queryClient, pr).catch(() => {});
  }

  function skipPR(pr: PR) {
    setSkipState((current) => {
      const keys = current.scope === scopeKey ? current.keys : EMPTY_SKIPPED;
      return { scope: scopeKey, keys: new Set(keys).add(prKey(pr)) };
    });
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
        key={scopeKey}
        query={query}
        listRef={listRef}
        deck={deck}
        prsCount={prs.length}
        visibleCount={visible.length}
        filters={filters}
        isLoading={isLoading}
        tabID={tabID}
        tabLabel={tabLabel}
        repo={repo}
        selectedPR={selectedPR}
        onPick={pickPR}
        onOpenDiff={openDiff}
        onSkip={skipPR}
        onRetry={() => void query.refetch()}
        onClearFilters={clearAllFilters}
        onOpenSearch={openSearch}
        onToggleFilters={toggleFilters}
        onCloseFilters={closeFilters}
        onClearSelection={() => selectPR(null)}
      />

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-3 font-mono text-micro text-fg-faint">
        <span className="tabular-nums">
          {isLoading
            ? "Loading…"
            : isFiltered
              ? `${visible.length} of ${prs.length} open`
              : `${visible.length} open`}
        </span>
        <span>j k move · enter open · f filter</span>
      </div>
    </div>
  );
}
