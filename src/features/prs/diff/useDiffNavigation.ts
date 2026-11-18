import { useEffect, useRef, useState } from "react";
import { findHunkIndex } from "./diffFile";
import type { DiffFileEntry, DiffTarget } from "./diffSelection";
import { activeSectionKey, type SectionRect } from "./diffScroll";

type Jump = {
  key: string;
  hunkIndex?: number;
  token: number;
};

type UseDiffNavigationOptions = {
  visible: DiffFileEntry[];
  visibleSignature: string;
  firstVisibleKey: string | null;
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
  focusTarget,
}: UseDiffNavigationOptions) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusMode, setFocusMode] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [jump, setJump] = useState<Jump | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const initialized = useRef(false);

  const paneRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const scrollFrame = useRef<number | null>(null);
  // Set while a click-driven jump owns the selection. Scroll inference must not
  // overwrite it; it only clears when the user scrolls for real.
  const programmaticScroll = useRef(false);

  // Keep the latest values reachable from the stable window key handler.
  const visibleRef = useRef(visible);
  const activeKeyRef = useRef(activeKey);
  const focusModeRef = useRef(focusMode);
  const expandedRef = useRef(expanded);
  const selectRef = useRef<(key: string) => void>(() => {});

  // Refs are synced in effects, never during render, so the stable window key
  // handler always sees the latest list and selection.
  useEffect(() => {
    visibleRef.current = visible;
    activeKeyRef.current = activeKey;
    focusModeRef.current = focusMode;
    expandedRef.current = expanded;
  });

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

  // A finding clicked in the Verdict tab opens its file and hunk here. The token
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
      const next = focusModeRef.current ? new Set<string>() : new Set(current);
      next.add(key);
      return next;
    });
    setFlash(hunkIndex === undefined ? key : `${key}:${hunkIndex}`);
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
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
        return;
      }
      if (event.key !== "j" && event.key !== "k") return;

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
  }, []);

  function requestJump(key: string, hunkIndex?: number) {
    programmaticScroll.current = true;
    setJump((current) => ({
      key,
      hunkIndex,
      token: (current?.token ?? 0) + 1,
    }));
  }

  function selectFile(key: string) {
    setActiveKey(key);
    setExpanded((current) => {
      const next = focusModeRef.current ? new Set<string>() : new Set(current);
      next.add(key);
      return next;
    });
    requestJump(key);
  }

  // A semantic tick owns its own hunk target: expand the file, then land on the
  // hunk header instead of the top of the file.
  function selectHunk(key: string, hunkIndex: number) {
    setActiveKey(key);
    setExpanded((current) => {
      const next = focusModeRef.current ? new Set<string>() : new Set(current);
      next.add(key);
      return next;
    });
    setFlash(`${key}:${hunkIndex}`);
    requestJump(key, hunkIndex);
  }

  function toggleFile(key: string) {
    setActiveKey(key);
    setExpanded((current) => {
      const next = focusModeRef.current ? new Set<string>() : new Set(current);
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
  }

  function toggleFocusMode() {
    const next = !focusMode;
    setFocusMode(next);
    if (next) {
      const keep = activeKey ?? firstVisibleKey;
      setExpanded(keep ? new Set([keep]) : new Set());
    } else {
      // Leaving focus mode opens every visible file. The user collapses the
      // ones they do not want to read.
      setExpanded(new Set(visible.map(({ key }) => key)));
    }
  }

  function releaseScrollLock() {
    programmaticScroll.current = false;
  }

  function handleScroll() {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const pane = paneRef.current;
      if (!pane) return;
      // A click-driven jump owns the selection until the user scrolls again.
      // Inferring from viewport position here is what used to highlight the
      // wrong file right after a sidebar click.
      if (programmaticScroll.current) return;
      const threshold = pane.getBoundingClientRect().top + 1;
      // Only rendered file bodies can own the scroll selection. A collapsed
      // file is a 36px header and scroll clamping can leave it under the top
      // edge after a jump to a short last file, so letting it win would steal
      // the highlight from the file the user just opened.
      const entries = visibleRef.current.filter(({ key }) =>
        expandedRef.current.has(key),
      );
      if (entries.length === 0) return;
      const sections: SectionRect[] = [];
      for (const { key } of entries) {
        const element = sectionRefs.current.get(key);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        sections.push({ key, top: rect.top, bottom: rect.bottom });
      }
      const current = activeSectionKey(sections, threshold);
      if (!current) return;
      setActiveKey((previous) => (previous === current ? previous : current));
    });
  }

  useEffect(() => {
    selectRef.current = selectFile;
  });

  return {
    activeKey,
    expanded,
    focusMode,
    flash,
    paneRef,
    filterInputRef,
    sectionRefs,
    selectFile,
    selectHunk,
    toggleFile,
    toggleFocusMode,
    handleScroll,
    releaseScrollLock,
  };
}
