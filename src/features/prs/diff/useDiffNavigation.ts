import { useCallback, useEffect, useRef, useState } from "react";
import { findHunkIndex } from "./diffFile";
import type { DiffFileEntry, DiffTarget } from "./diffSelection";
import {
  activeSectionKey,
  clampedAtBottom,
  type SectionRect,
} from "./diffScroll";

type Jump = {
  key: string;
  hunkIndex?: number;
  token: number;
};

/**
 * Briefly highlighted target. `key` names the owning file so only that section
 * receives the label and the rest can stay memoized.
 */
type Flash = {
  key: string;
  label: string;
};

type UseDiffNavigationOptions = {
  visible: DiffFileEntry[];
  visibleSignature: string;
  firstVisibleKey: string | null;
  /** False in the grouped path view: there a step opens as a unit. */
  focusModeApplies: boolean;
  /** The strip/popover owns this; the hook only honours it. */
  focusMode: boolean;
  /** Open the Files popover so `/` can focus its search input. */
  openFilter: () => void;
  /** Present in the grouped path view: `j`/`k` move between steps, not files. */
  stepNavigation?: {
    ids: string[];
    activeID: string | null;
    onSelect: (id: string) => void;
  };
  focusTarget?: DiffTarget;
};

/**
 * Selection, expansion, scrolling and keyboard navigation for the diff pane.
 *
 * The window key handler and the scroll handler are registered once, so every
 * value they read goes through a ref synced in an effect. Splitting these back
 * into a component render closure is what caused the stale-selection bugs this
 * hook exists to avoid.
 */
export function useDiffNavigation({
  visible,
  visibleSignature,
  firstVisibleKey,
  focusModeApplies,
  focusMode,
  openFilter,
  stepNavigation,
  focusTarget,
}: UseDiffNavigationOptions) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [jump, setJump] = useState<Jump | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const initialized = useRef(false);

  const paneRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const scrollFrame = useRef<number | null>(null);
  // Reused scratch buffer: the scroll handler runs once per frame over every
  // expanded section, so it must not allocate a fresh array each time.
  const sectionRects = useRef<SectionRect[]>([]);
  // Set while a click-driven jump owns the selection. Scroll inference must not
  // overwrite it; it only clears when the user scrolls for real.
  const programmaticScroll = useRef(false);

  // Keep the latest values reachable from the stable window key handler.
  const visibleRef = useRef(visible);
  const activeKeyRef = useRef(activeKey);
  const singleFileRef = useRef(focusMode && focusModeApplies);
  const stepNavigationRef = useRef(stepNavigation);
  const expandedRef = useRef(expanded);
  const selectRef = useRef<(key: string) => void>(() => {});

  // Refs are synced in effects, never during render, so the stable window key
  // handler always sees the latest list and selection.
  useEffect(() => {
    visibleRef.current = visible;
    activeKeyRef.current = activeKey;
    singleFileRef.current = focusMode && focusModeApplies;
    stepNavigationRef.current = stepNavigation;
    expandedRef.current = expanded;
  });

  // Focus mode is a policy, not a per-file choice: turning it on keeps one
  // file open, turning it off opens every visible file. Guarded by a ref so a
  // visible-list change does not re-apply the mode.
  const previousFocusMode = useRef(focusMode);
  useEffect(() => {
    if (previousFocusMode.current === focusMode) return;
    previousFocusMode.current = focusMode;
    if (focusMode) {
      const keep = activeKeyRef.current ?? firstVisibleKey;
      setExpanded(keep ? new Set([keep]) : new Set());
    } else {
      setExpanded(new Set(visibleRef.current.map(({ key }) => key)));
    }
  }, [focusMode, firstVisibleKey]);

  // Open the first file so the diff is visible without a click, but leave the
  // rest collapsed for large pull requests.
  useEffect(() => {
    if (initialized.current || !firstVisibleKey) return;
    initialized.current = true;
    setExpanded(new Set([firstVisibleKey]));
    setActiveKey(firstVisibleKey);
  }, [firstVisibleKey]);

  // A filter or the cosmetic toggle can hide the active file; fall back to the
  // first file that is still visible.
  useEffect(() => {
    const entries = visibleRef.current;
    if (entries.length === 0) return;
    setActiveKey((current) =>
      current && entries.some((entry) => entry.key === current)
        ? current
        : entries[0].key,
    );
  }, [visibleSignature]);

  // A finding clicked in the Review tab opens its file and hunk here. The token
  // changes on every click, so two findings in the same file both jump. A file
  // hidden by a user filter is left alone rather than silently un-filtered.
  const focusPath = focusTarget?.path;
  const focusLine = focusTarget?.line;
  const focusToken = focusTarget?.token;
  useEffect(() => {
    if (focusToken === undefined || focusPath === undefined) return;
    const entries = visibleRef.current;
    if (entries.length === 0) return;
    const entry = entries.find(
      ({ file }) => file.path === focusPath || file.oldPath === focusPath,
    );
    if (!entry) return;

    const key = entry.key;
    const hunkIndex = findHunkIndex(entry.file, focusLine);
    programmaticScroll.current = true;
    setActiveKey(key);
    setExpanded((current) => {
      const next = singleFileRef.current ? new Set<string>() : new Set(current);
      next.add(key);
      return next;
    });
    setFlash(
      hunkIndex === undefined
        ? { key, label: key }
        : { key, label: `${key}:${hunkIndex}` },
    );
    setJump((current) => ({
      key,
      hunkIndex,
      token: (current?.token ?? 0) + 1,
    }));
  }, [focusToken, focusPath, focusLine, visibleSignature]);

  // Run the jump after the expanded-state commit, never before it: collapsing
  // the previously open file changes the height of every section above, so a
  // synchronous scrollIntoView would land on the wrong file.
  useEffect(() => {
    if (!jump) return;
    const pane = paneRef.current;
    const section = sectionRefs.current.get(jump.key);
    let element: HTMLElement | undefined = section;
    let id: string | null = null;
    if (jump.hunkIndex !== undefined && pane) {
      id = `${jump.key}:${jump.hunkIndex}`;
      const hunk = Array.from(
        pane.querySelectorAll<HTMLElement>("[data-diff-hunk]"),
      ).find((candidate) => candidate.dataset.diffHunk === id);
      element = hunk ?? section;
    }
    if (!element) return;
    element.scrollIntoView({ block: "start" });
  }, [jump]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    return () => {
      if (scrollFrame.current !== null) {
        cancelAnimationFrame(scrollFrame.current);
      }
    };
  }, []);

  // Keyboard navigation lives on the window because focus can sit on the tab
  // strip or the file sidebar when the diff opens.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        openFilter();
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
        return;
      }
      if (event.key !== "j" && event.key !== "k") return;

      // The grouped path view's unit is the step: the rail lists steps, so the
      // keyboard moves between them instead of the files inside one.
      const steps = stepNavigationRef.current;
      if (steps && steps.ids.length > 0) {
        const current = steps.activeID ? steps.ids.indexOf(steps.activeID) : -1;
        const base = current === -1 ? (event.key === "j" ? -1 : 0) : current;
        const delta = event.key === "j" ? 1 : -1;
        const nextIndex = Math.min(
          Math.max(base + delta, 0),
          steps.ids.length - 1,
        );
        const next = steps.ids[nextIndex];
        if (next === undefined) return;
        event.preventDefault();
        steps.onSelect(next);
        return;
      }

      const keys = visibleRef.current.map((entry) => entry.key);
      if (keys.length === 0) return;
      event.preventDefault();
      const current = activeKeyRef.current;
      const index = current ? keys.indexOf(current) : -1;
      const base = index === -1 ? (event.key === "j" ? -1 : 0) : index;
      const step = event.key === "j" ? 1 : -1;
      const nextIndex = Math.min(Math.max(base + step, 0), keys.length - 1);
      selectRef.current(keys[nextIndex]);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openFilter]);

  // Stable so a memoized file section never re-renders because the parent
  // render handed it a fresh closure. They read mutable state through refs.
  const requestJump = useCallback((key: string, hunkIndex?: number) => {
    programmaticScroll.current = true;
    setJump((current) => ({
      key,
      hunkIndex,
      token: (current?.token ?? 0) + 1,
    }));
  }, []);

  const selectFile = useCallback(
    (key: string) => {
      setActiveKey(key);
      setExpanded((current) => {
        const next = singleFileRef.current
          ? new Set<string>()
          : new Set(current);
        next.add(key);
        return next;
      });
      requestJump(key);
    },
    [requestJump],
  );

  // A semantic tick owns its own hunk target: expand the file, then land on the
  // hunk header instead of the top of the file.
  const selectHunk = useCallback(
    (key: string, hunkIndex: number) => {
      setActiveKey(key);
      setExpanded((current) => {
        const next = singleFileRef.current
          ? new Set<string>()
          : new Set(current);
        next.add(key);
        return next;
      });
      setFlash({ key, label: `${key}:${hunkIndex}` });
      requestJump(key, hunkIndex);
    },
    [requestJump],
  );

  const toggleFile = useCallback((key: string) => {
    setActiveKey(key);
    setExpanded((current) => {
      const next = singleFileRef.current ? new Set<string>() : new Set(current);
      if (current.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    // Collapsing or expanding reflows the pane; keep the clicked file selected
    // instead of letting the scroll handler reassign it.
    programmaticScroll.current = true;
  }, []);

  /** Path steps open as a unit; collapse remains available per file. */
  const expandFiles = useCallback((keys: string[]) => {
    setExpanded(new Set(keys));
  }, []);

  const releaseScrollLock = useCallback(() => {
    programmaticScroll.current = false;
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const pane = paneRef.current;
      if (!pane) return;
      // A click-driven jump owns the selection until the user scrolls again.
      // Inferring from viewport position here is what used to highlight the
      // wrong file right after a sidebar click.
      if (programmaticScroll.current) return;
      const visibleEntries = visibleRef.current;
      if (visibleEntries.length === 0) return;
      const threshold = pane.getBoundingClientRect().top + 1;
      // Only rendered file bodies can own the scroll selection. A collapsed
      // file is a 36px header and scroll clamping can leave it under the top
      // edge after a jump to a short last file, so letting it win would steal
      // the highlight from the file the user just opened.
      const sections = sectionRects.current;
      let count = 0;
      for (const { key } of visibleEntries) {
        if (!expandedRef.current.has(key)) continue;
        const element = sectionRefs.current.get(key);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        let slot = sections[count];
        if (!slot) {
          slot = { key, top: 0, bottom: 0 };
          sections[count] = slot;
        }
        slot.key = key;
        slot.top = rect.top;
        slot.bottom = rect.bottom;
        count += 1;
      }
      // At the end of the pane the top edge can never reach the last files, so
      // short trailing files would never win the top-edge test. The last
      // rendered body owns the selection there while it still reaches below
      // the top edge. Once the collapsed headers below it fill the viewport,
      // the selection returns to the last rail row: that header is what the
      // user is looking at. Focus mode keeps the open file instead: it is the
      // only body, and scrolling through it must not jump to a header below.
      if (clampedAtBottom(pane)) {
        const lastRow = visibleEntries[visibleEntries.length - 1].key;
        const lastBody = count > 0 ? sections[count - 1] : null;
        const last =
          lastBody !== null &&
          (singleFileRef.current || lastBody.bottom > threshold)
            ? lastBody.key
            : lastRow;
        setActiveKey((previous) => (previous === last ? previous : last));
        return;
      }
      if (count === 0) return;
      const current = activeSectionKey(sections, threshold, count);
      if (!current) return;
      setActiveKey((previous) => (previous === current ? previous : current));
    });
  }, []);

  useEffect(() => {
    selectRef.current = selectFile;
  });

  return {
    activeKey,
    expanded,
    flash,
    paneRef,
    filterInputRef,
    sectionRefs,
    selectFile,
    selectHunk,
    toggleFile,
    expandFiles,
    handleScroll,
    releaseScrollLock,
  };
}
