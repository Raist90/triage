import { create } from "zustand";
import type { CheckState, DiffFileKind, ReviewState } from "../lib/types";

/**
 * Ephemeral UI state only. Server data belongs to TanStack Query, never here.
 *
 * `selectedRepo` is `owner/name`, or null for "All repos".
 * `selectedPR` is `owner/name#number`, or null when nothing is open.
 */
export type PRFilterSection = "review" | "checks" | "authors" | "repos";

/** Sidebar ordering for the diff file list. */
export type DiffSort = "priority" | "path";

/** The diff rail either lists files or walks the deterministic review path. */
export type DiffMode = "files" | "path";

/** A cross-pane jump from the deck into one detail tab. */
export type DetailIntentTab = "preflight" | "diff" | "review";

export type DetailIntent = {
  prKey: string;
  tab: DetailIntentTab;
  /** Diff target for risk/phase jumps; a token re-triggers the same jump. */
  diffTarget?: { path: string; line?: number };
  token: number;
};

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
  /** Files keeps the filterable file list; path walks the synthetic commits. */
  diffMode: DiffMode;
  /** Whether low-focus files are hidden from the diff file list. */
  hideLowPriority: boolean;
  /** Whether the diff shows the semantic change map on its right edge. */
  showSemanticRail: boolean;
  /** Width in px of the diff file rail, session-only. */
  diffRailWidth: number;
  /** PR list facets and search, session-wide. */
  prFilters: PRFilters;
  /** Hero/row actions that must open a specific detail tab. */
  detailIntent: DetailIntent | null;
  selectRepo: (repo: string | null) => void;
  setActiveTab: (tabID: string) => void;
  selectPR: (pr: string | null) => void;
  setDetailIntent: (intent: DetailIntent) => void;
  clearDetailIntent: () => void;
  closeDetail: () => void;
  toggleSidebar: () => void;
  toggleDetailFullscreen: () => void;
  toggleFileKind: (kind: DiffFileKind) => void;
  clearFileKinds: () => void;
  setDiffSort: (sort: DiffSort) => void;
  setDiffMode: (mode: DiffMode) => void;
  toggleLowPriority: () => void;
  toggleSemanticRail: () => void;
  setDiffRailWidth: (width: number) => void;
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
  diffMode: "files",
  hideLowPriority: false,
  showSemanticRail: true,
  diffRailWidth: 208,
  prFilters: EMPTY_PR_FILTERS,
  detailIntent: null,
  selectRepo: (repo) =>
    set((state) => ({
      selectedRepo: repo,
      selectedPR: null,
      detailOpen: false,
      detailFullscreen: false,
      detailIntent: null,
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
      detailIntent: null,
    }),
  selectPR: (pr) =>
    set({
      selectedPR: pr,
      detailOpen: pr !== null,
      // A plain row click opens the default tab. Hero actions set the intent
      // right after selecting, so a stale intent must not survive.
      detailIntent: null,
    }),
  setDetailIntent: (intent) => set({ detailIntent: intent }),
  clearDetailIntent: () => set({ detailIntent: null }),
  closeDetail: () =>
    set({ detailOpen: false, detailFullscreen: false, detailIntent: null }),
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
  setDiffMode: (mode) => set({ diffMode: mode }),
  toggleLowPriority: () =>
    set((state) => ({ hideLowPriority: !state.hideLowPriority })),
  toggleSemanticRail: () =>
    set((state) => ({ showSemanticRail: !state.showSemanticRail })),
  setDiffRailWidth: (width) => set({ diffRailWidth: width }),
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
