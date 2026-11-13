import { create } from "zustand";
import type { CheckState, ReviewState } from "../lib/types";
import type { DiffFileKind } from "../features/prs/diffFile";

/**
 * Ephemeral UI state only. Server data belongs to TanStack Query, never here.
 *
 * `selectedRepo` is `owner/name`, or null for "All repos".
 * `selectedPR` is `owner/name#number`, or null when nothing is open.
 */
export type PRFilterSection = "review" | "checks" | "authors" | "repos";

/** Sidebar ordering for the diff file list. */
export type DiffSort = "priority" | "path";

/**
 * Client-side view over the loaded list. Filters never change the query key, so
 * toggling one costs no GitHub request and keeps the list mounted.
 */
export type PRFilters = {
  query: string;
  review: ReviewState[];
  checks: CheckState[];
  authors: string[];
  /** `owner/name`; only meaningful while the repo scope is "All repos". */
  repos: string[];
  hideDrafts: boolean;
};

export const EMPTY_PR_FILTERS: PRFilters = {
  query: "",
  review: [],
  checks: [],
  authors: [],
  repos: [],
  hideDrafts: false,
};

type UIState = {
  selectedRepo: string | null;
  activeTabID: string | null;
  selectedPR: string | null;
  /** Whether the detail panel is open over the list. */
  detailOpen: boolean;
  /** Whether the left sidebar is visible. */
  sidebarOpen: boolean;
  /** Whether the detail pane hides the rail and repo panel. */
  detailFullscreen: boolean;
  /** Diff file categories the user chose to exclude, session-wide. */
  hiddenFileKinds: DiffFileKind[];
  /** Priority keeps the highest-focus file first; path restores patch order. */
  diffSort: DiffSort;
  /** Whether low-focus files are hidden from the diff file list. */
  hideLowPriority: boolean;
  /** PR list facets and search, session-wide. */
  prFilters: PRFilters;
  selectRepo: (repo: string | null) => void;
  setActiveTab: (tabID: string) => void;
  selectPR: (pr: string | null) => void;
  closeDetail: () => void;
  toggleSidebar: () => void;
  toggleDetailFullscreen: () => void;
  toggleFileKind: (kind: DiffFileKind) => void;
  clearFileKinds: () => void;
  setDiffSort: (sort: DiffSort) => void;
  toggleLowPriority: () => void;
  setFilterQuery: (query: string) => void;
  toggleFilterFacet: (section: PRFilterSection, value: string) => void;
  setFilterFacet: (section: PRFilterSection, values: string[]) => void;
  toggleHideDrafts: () => void;
  clearPRFilters: () => void;
};

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}

export const useUIStore = create<UIState>((set) => ({
  selectedRepo: null,
  activeTabID: null,
  selectedPR: null,
  detailOpen: false,
  sidebarOpen: true,
  detailFullscreen: false,
  hiddenFileKinds: [],
  diffSort: "priority",
  hideLowPriority: false,
  prFilters: EMPTY_PR_FILTERS,
  selectRepo: (repo) =>
    set((state) => ({
      selectedRepo: repo,
      selectedPR: null,
      detailOpen: false,
      detailFullscreen: false,
      // The repo facet is a narrower view of "All repos"; an explicit scope
      // supersedes it, so it must not linger invisibly.
      prFilters: { ...state.prFilters, repos: [] },
    })),
  setActiveTab: (tabID) =>
    set({
      activeTabID: tabID,
      selectedPR: null,
      detailOpen: false,
      detailFullscreen: false,
    }),
  selectPR: (pr) => set({ selectedPR: pr, detailOpen: pr !== null }),
  closeDetail: () => set({ detailOpen: false, detailFullscreen: false }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  // The repo panel preference is left alone, so exiting fullscreen restores it.
  toggleDetailFullscreen: () =>
    set((state) => ({ detailFullscreen: !state.detailFullscreen })),
  toggleFileKind: (kind) =>
    set((state) => ({
      hiddenFileKinds: state.hiddenFileKinds.includes(kind)
        ? state.hiddenFileKinds.filter((current) => current !== kind)
        : [...state.hiddenFileKinds, kind],
    })),
  clearFileKinds: () => set({ hiddenFileKinds: [] }),
  setDiffSort: (sort) => set({ diffSort: sort }),
  toggleLowPriority: () =>
    set((state) => ({ hideLowPriority: !state.hideLowPriority })),
  setFilterQuery: (query) =>
    set((state) => ({ prFilters: { ...state.prFilters, query } })),
  toggleFilterFacet: (section, value) =>
    set((state) => {
      const filters = state.prFilters;
      switch (section) {
        case "review": {
          const review = toggle(filters.review, value as ReviewState);
          return { prFilters: { ...filters, review } };
        }
        case "checks": {
          const checks = toggle(filters.checks, value as CheckState);
          return { prFilters: { ...filters, checks } };
        }
        case "authors":
          return {
            prFilters: { ...filters, authors: toggle(filters.authors, value) },
          };
        case "repos":
          return {
            prFilters: { ...filters, repos: toggle(filters.repos, value) },
          };
      }
    }),
  toggleHideDrafts: () =>
    set((state) => ({
      prFilters: {
        ...state.prFilters,
        hideDrafts: !state.prFilters.hideDrafts,
      },
    })),
  setFilterFacet: (section, values) =>
    set((state) => {
      const filters = state.prFilters;
      switch (section) {
        case "review":
          return { prFilters: { ...filters, review: values as ReviewState[] } };
        case "checks":
          return { prFilters: { ...filters, checks: values as CheckState[] } };
        case "authors":
          return { prFilters: { ...filters, authors: values } };
        case "repos":
          return { prFilters: { ...filters, repos: values } };
      }
    }),
  clearPRFilters: () =>
    set((state) => ({
      prFilters: { ...EMPTY_PR_FILTERS, query: state.prFilters.query },
    })),
}));
