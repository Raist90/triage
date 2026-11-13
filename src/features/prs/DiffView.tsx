import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  Focus,
  MessageSquarePlus,
  PanelRight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffSpan,
  InlineComment,
  SemanticChange,
  SemanticSummary,
} from "../../lib/types";
import { Markdown } from "../../components/Markdown";
import { Button, IconButton } from "../../components/ui";
import { formatRelative } from "../../lib/time";
import { useUIStore } from "../../stores/ui";
import { DiffSidebar } from "./DiffSidebar";
import { SemanticRail } from "./SemanticRail";
import type { DiffCommentsController } from "./useDiffComments";
import {
  anchorSemanticChanges,
  compareByFocus,
  DIFF_FILE_KINDS,
  fileKey,
  fileKinds,
  focusBand,
  isCosmeticFile,
  reviewSignals,
  splitPath,
  type DiffFileKind,
} from "./diffFile";
import {
  badgeClassName,
  changeMark,
  tallyChanges,
  tallyText,
} from "./semantics";

type DiffViewProps = {
  files: DiffFile[];
  semanticAvailable: boolean;
  semanticSummary?: SemanticSummary;
  comments: DiffCommentsController;
  headSHA: string;
  canComment: boolean;
  viewerLogin?: string;
};

/** One commentable diff line: GitHub needs path + side + line + head commit. */
type CommentAnchor = {
  path: string;
  side: "RIGHT" | "LEFT";
  line: number;
};

function anchorKey(anchor: CommentAnchor): string {
  return `${anchor.path}\u0000${anchor.side}\u0000${anchor.line}`;
}

/** New comments anchor to the side the line belongs to; context defaults right. */
function lineAnchor(path: string, line: DiffLine): CommentAnchor | null {
  if (line.kind === "del") {
    return line.oldNumber ? { path, side: "LEFT", line: line.oldNumber } : null;
  }
  return line.newNumber ? { path, side: "RIGHT", line: line.newNumber } : null;
}

/** Existing comments may sit on either side of a context line. */
function lineAnchors(path: string, line: DiffLine): CommentAnchor[] {
  const anchors: CommentAnchor[] = [];
  if (line.oldNumber) {
    anchors.push({ path, side: "LEFT", line: line.oldNumber });
  }
  if (line.newNumber) {
    anchors.push({ path, side: "RIGHT", line: line.newNumber });
  }
  return anchors;
}

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  added: "Added",
  removed: "Removed",
  modified: "Modified",
  renamed: "Renamed",
};

export function DiffView({
  files,
  semanticAvailable,
  semanticSummary,
  comments,
  headSHA,
  canComment,
  viewerLogin,
}: DiffViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<string | null>(null);
  const [hideCosmetic, setHideCosmetic] = useState(true);
  const [focusMode, setFocusMode] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [jump, setJump] = useState<{
    key: string;
    hunkIndex?: number;
    token: number;
  } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const initialized = useRef(false);

  const hiddenKinds = useUIStore((state) => state.hiddenFileKinds);
  const toggleFileKind = useUIStore((state) => state.toggleFileKind);
  const clearFileKinds = useUIStore((state) => state.clearFileKinds);
  const diffSort = useUIStore((state) => state.diffSort);
  const setDiffSort = useUIStore((state) => state.setDiffSort);
  const hideLowPriority = useUIStore((state) => state.hideLowPriority);
  const toggleLowPriority = useUIStore((state) => state.toggleLowPriority);
  const showSemanticRail = useUIStore((state) => state.showSemanticRail);
  const toggleSemanticRail = useUIStore((state) => state.toggleSemanticRail);

  const paneRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const scrollFrame = useRef<number | null>(null);
  // Set while a click-driven jump owns the selection. Scroll inference must not
  // overwrite it; it only clears when the user scrolls for real.
  const programmaticScroll = useRef(false);

  const kindCounts = DIFF_FILE_KINDS.reduce(
    (counts, kind) => {
      counts[kind] = files.filter((file) =>
        fileKinds(file).includes(kind),
      ).length;
      return counts;
    },
    {} as Record<DiffFileKind, number>,
  );
  const hiddenByKind = hiddenKinds.length
    ? files.filter((file) =>
        fileKinds(file).some((kind) => hiddenKinds.includes(kind)),
      ).length
    : 0;
  const kindFiltered = files.filter(
    (file) => !fileKinds(file).some((kind) => hiddenKinds.includes(kind)),
  );
  const cosmeticFiles = kindFiltered.filter(isCosmeticFile).length;
  const hasReview = files.some((file) => file.review !== undefined);
  const highCount = files.filter((file) => focusBand(file) === "high").length;
  const baseVisible = files
    .map((file, index) => ({ file, index, key: fileKey(file, index) }))
    .filter(
      ({ file }) =>
        !fileKinds(file).some((kind) => hiddenKinds.includes(kind)) &&
        !(hideCosmetic && isCosmeticFile(file)),
    );
  const lowCount = baseVisible.filter(
    ({ file }) => file.review?.band === "low",
  ).length;
  const hiddenCount =
    hiddenByKind +
    (hideCosmetic ? cosmeticFiles : 0) +
    (hideLowPriority ? lowCount : 0);
  const visible = baseVisible
    .filter(({ file }) => !(hideLowPriority && file.review?.band === "low"))
    .sort((a, b) =>
      diffSort === "priority"
        ? compareByFocus(a.file, b.file) || a.index - b.index
        : a.index - b.index,
    );
  const firstVisibleKey = visible[0]?.key ?? null;
  const visibleSignature = visible.map(({ key }) => key).join("\u0000");
  const railLayoutKey = visible
    .map(
      ({ key, file }) =>
        `${key}:${expanded.has(key) ? "open" : "closed"}:${file.semantic?.length ?? 0}`,
    )
    .join("\u0000");
  const hasSemantic =
    semanticAvailable && files.some((file) => (file.semantic?.length ?? 0) > 0);
  const visibleSemantic =
    hasSemantic && visible.some(({ file }) => (file.semantic?.length ?? 0) > 0);

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
      let current: string | null = null;
      let firstBelow: string | null = null;
      for (const { key } of entries) {
        const element = sectionRefs.current.get(key);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.top <= threshold && rect.bottom > threshold) {
          current = key;
          break;
        }
        if (!firstBelow && rect.top > threshold) firstBelow = key;
      }
      current ??= firstBelow ?? entries[entries.length - 1]?.key ?? null;
      if (!current) return;
      setActiveKey((previous) => (previous === current ? previous : current));
    });
  }

  useEffect(() => {
    selectRef.current = selectFile;
  });

  const showSummary = semanticAvailable && (semanticSummary?.total ?? 0) > 0;
  const hasSummaryLine = showSummary || highCount > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas pr-1 pl-3">
        <p className="tabular min-w-0 truncate text-meta text-fg-faint">
          {showSummary ? summaryText(semanticSummary!) : null}
          {highCount > 0 ? (
            <span>
              {showSummary ? " · " : ""}
              {highCount} high focus
            </span>
          ) : null}
          {cosmeticFiles > 0 ? (
            <span>
              {hasSummaryLine ? " · " : ""}
              {cosmeticFiles} cosmetic-only{" "}
              {cosmeticFiles === 1 ? "file" : "files"}
            </span>
          ) : null}
          {hiddenByKind > 0 ? (
            <span>
              {hasSummaryLine || cosmeticFiles > 0 ? " · " : ""}
              {hiddenByKind} {hiddenByKind === 1 ? "file" : "files"} hidden
              <button
                type="button"
                onClick={clearFileKinds}
                className="ml-2 text-fg-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-fg"
              >
                Clear
              </button>
            </span>
          ) : null}
          {hideLowPriority && lowCount > 0 ? (
            <span>
              {hasSummaryLine || cosmeticFiles > 0 || hiddenByKind > 0
                ? " · "
                : ""}
              {lowCount} low focus hidden
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-0">
          <IconButton
            label={focusMode ? "Show all files" : "Show one file at a time"}
            active={focusMode}
            onClick={toggleFocusMode}
          >
            <Focus className="size-4" aria-hidden />
          </IconButton>
          {cosmeticFiles > 0 ? (
            <IconButton
              label="Hide cosmetic-only files"
              active={hideCosmetic}
              onClick={() => setHideCosmetic((current) => !current)}
            >
              <EyeOff className="size-4" aria-hidden />
            </IconButton>
          ) : null}
          {hasSemantic ? (
            <IconButton
              label={
                showSemanticRail
                  ? "Hide semantic change map"
                  : "Show semantic change map"
              }
              active={showSemanticRail}
              onClick={toggleSemanticRail}
            >
              <PanelRight className="size-4" aria-hidden />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <DiffSidebar
          files={visible}
          activeKey={activeKey}
          filter={filter}
          filterInputRef={filterInputRef}
          kindCounts={kindCounts}
          hiddenKinds={hiddenKinds}
          totalCount={files.length}
          hiddenCount={hiddenCount}
          hasReview={hasReview}
          sort={diffSort}
          hideLowPriority={hideLowPriority}
          lowCount={lowCount}
          onSortChange={setDiffSort}
          onToggleLowPriority={toggleLowPriority}
          onFilterChange={setFilter}
          onToggleKind={toggleFileKind}
          onSelect={selectFile}
        />

        <div
          ref={paneRef}
          onScroll={handleScroll}
          onWheel={releaseScrollLock}
          onTouchStart={releaseScrollLock}
          onPointerDown={releaseScrollLock}
          className="min-w-0 flex-1 overflow-y-auto"
        >
          {visible.length === 0 ? (
            kindFiltered.length === 0 ? (
              <p className="border-b border-line px-3 py-3 text-meta text-fg-faint">
                All files are hidden by filters.{" "}
                <button
                  type="button"
                  onClick={clearFileKinds}
                  className="text-fg-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-fg"
                >
                  Clear filters
                </button>
              </p>
            ) : (
              <p className="border-b border-line px-3 py-3 text-meta text-fg-faint">
                All files are cosmetic-only.{" "}
                <button
                  type="button"
                  onClick={() => setHideCosmetic(false)}
                  className="text-fg-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-fg"
                >
                  Show them
                </button>
              </p>
            )
          ) : null}

          {visible.map(({ file, key }) => {
            const open = expanded.has(key);
            const { dir, name } = splitPath(file.path);
            const signals = reviewSignals(file);
            const fileCommentCount = comments.comments.filter(
              (comment) =>
                comment.path === file.path &&
                comment.commitID === headSHA &&
                comment.line !== undefined,
            ).length;
            return (
              <section
                key={key}
                data-diff-file={key}
                ref={(element) => {
                  if (element) sectionRefs.current.set(key, element);
                  else sectionRefs.current.delete(key);
                }}
                className="border-b border-line last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => toggleFile(key)}
                  aria-expanded={open}
                  className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-b border-line bg-canvas px-2 text-left transition-colors hover:bg-surface"
                >
                  {open ? (
                    <ChevronDown
                      className="size-3.5 shrink-0 text-fg-faint"
                      aria-hidden
                    />
                  ) : (
                    <ChevronRight
                      className="size-3.5 shrink-0 text-fg-faint"
                      aria-hidden
                    />
                  )}
                  <span className="flex min-w-0 flex-1 items-center font-mono text-meta">
                    <span className="inline-block max-w-[55%] truncate align-bottom text-fg-faint">
                      {dir}
                    </span>
                    <span className="shrink-0 text-fg-body">{name}</span>
                  </span>
                  <span className="shrink-0 text-micro tracking-[0.06em] text-fg-faint uppercase">
                    {STATUS_LABEL[file.status]}
                  </span>
                  {file.oldPath ? (
                    <span className="max-w-40 shrink-0 truncate font-mono text-micro text-fg-faint">
                      from {file.oldPath}
                    </span>
                  ) : null}
                  {isCosmeticFile(file) ? (
                    <span className="shrink-0 text-micro tracking-[0.06em] text-fg-faint uppercase">
                      cosmetic
                    </span>
                  ) : null}
                  {signals.length > 0 ? (
                    <span
                      title={signals.join(" · ")}
                      className="max-w-64 shrink-0 truncate text-micro text-fg-faint"
                    >
                      {signals.join(" · ")}
                    </span>
                  ) : null}
                  {fileCommentCount > 0 ? (
                    <span className="shrink-0 text-micro text-fg-faint">
                      {fileCommentCount}{" "}
                      {fileCommentCount === 1 ? "comment" : "comments"}
                    </span>
                  ) : null}
                  <span className="tabular ml-auto shrink-0 pl-2 font-mono text-meta text-fg-faint">
                    <span className="text-accent">+{file.additions}</span>
                    <span className="px-1 text-line-strong">/</span>
                    <span className="text-danger">−{file.deletions}</span>
                  </span>
                </button>

                {open ? (
                  <FilePatch
                    file={file}
                    fileKey={key}
                    comments={comments}
                    headSHA={headSHA}
                    canComment={canComment}
                    draft={draft}
                    onDraftChange={setDraft}
                    viewerLogin={viewerLogin}
                    flash={flash}
                  />
                ) : null}
              </section>
            );
          })}
        </div>

        {visibleSemantic && showSemanticRail ? (
          <SemanticRail
            paneRef={paneRef}
            files={visible}
            expanded={expanded}
            singleFile={focusMode}
            layoutKey={railLayoutKey}
            onJump={selectHunk}
          />
        ) : null}
      </div>
    </div>
  );
}

function summaryText(summary: SemanticSummary): string {
  const parts = [
    [summary.added, "added"],
    [summary.modified, "modified"],
    [summary.deleted, "deleted"],
    [summary.moved, "moved"],
    [summary.renamed, "renamed"],
    [summary.reordered, "reordered"],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`);

  const total = summary.total;
  return `${total} semantic ${total === 1 ? "change" : "changes"}${
    parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
  }`;
}

type RawHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Splits a raw patch into hunks; header lines before the first hunk drop. */
function parsePatch(patch: string): RawHunk[] {
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  const hunks: RawHunk[] = [];
  let current: RawHunk | null = null;
  for (const line of lines) {
    const match = HUNK_HEADER.exec(line);
    if (match) {
      current = {
        header: line,
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return hunks;
}

type FilePatchProps = {
  file: DiffFile;
  fileKey: string;
  comments: DiffCommentsController;
  headSHA: string;
  canComment: boolean;
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  viewerLogin?: string;
  /** `${fileKey}:${hunkIndex}` of a rail jump, highlighted briefly. */
  flash: string | null;
};

function FilePatch({
  file,
  fileKey,
  comments,
  headSHA,
  canComment,
  draft,
  onDraftChange,
  viewerLogin,
  flash,
}: FilePatchProps) {
  const [showUnanchored, setShowUnanchored] = useState(false);

  if (file.binary) {
    return (
      <p className="border-t border-line bg-canvas px-3 py-2 text-meta text-fg-faint">
        Binary file changed.
      </p>
    );
  }

  const hunks = file.hunks ?? [];
  if (hunks.length === 0) {
    return <RawPatch patch={file.patch} />;
  }

  const byAnchor = new Map<string, InlineComment[]>();
  for (const comment of comments.comments) {
    if (
      comment.path !== file.path ||
      comment.commitID !== headSHA ||
      comment.line === undefined ||
      (comment.side !== "RIGHT" && comment.side !== "LEFT")
    ) {
      continue;
    }
    const anchor: CommentAnchor = {
      path: comment.path,
      side: comment.side,
      line: comment.line,
    };
    const key = anchorKey(anchor);
    const bucket = byAnchor.get(key);
    if (bucket) bucket.push(comment);
    else byAnchor.set(key, [comment]);
  }
  for (const bucket of byAnchor.values()) {
    bucket.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const changes = file.semantic ?? [];
  const { byHunk, unanchored } = anchorSemanticChanges(
    file.path,
    hunks,
    changes,
  );

  return (
    <div className="overflow-x-auto border-t border-line bg-canvas">
      <div className="min-w-max font-mono text-code">
        {unanchored.length > 0 ? (
          <div className="border-b border-line">
            <button
              type="button"
              onClick={() => setShowUnanchored((current) => !current)}
              aria-expanded={showUnanchored}
              className="flex h-7 w-full items-center gap-2 px-3 font-sans text-meta text-fg-faint transition-colors hover:bg-surface/60 hover:text-fg-muted"
            >
              <span className="rounded-[3px] border border-line-strong px-1 font-mono text-micro text-fg-muted">
                {unanchored.length}
              </span>
              unanchored semantic{" "}
              {unanchored.length === 1 ? "change" : "changes"}
              <ChevronDown
                className={`ml-auto size-3.5 transition-transform ${
                  showUnanchored ? "" : "-rotate-90"
                }`}
                aria-hidden
              />
            </button>
            {showUnanchored ? (
              <div className="pb-1">
                {unanchored.map((change, index) => (
                  <ChangeAnnotation
                    key={`${change.entityType}:${change.entityName}:${index}`}
                    change={change}
                    filePath={file.path}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {hunks.map((hunk, index) => (
          <div key={`${hunk.header}:${index}`}>
            <HunkRows
              hunk={hunk}
              hunkKey={`${fileKey}:${index}`}
              changes={byHunk[index] ?? []}
              flash={flash === `${fileKey}:${index}`}
              path={file.path}
              comments={comments}
              headSHA={headSHA}
              byAnchor={byAnchor}
              canComment={canComment}
              draft={draft}
              onDraftChange={onDraftChange}
              viewerLogin={viewerLogin}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const ROW_GRID = "grid grid-cols-[1.5rem_2.75rem_2.75rem_auto]";

type HunkRowsProps = {
  hunk: DiffHunk;
  hunkKey: string;
  /** Semantic changes anchored to this hunk; rendered only on demand. */
  changes: SemanticChange[];
  flash: boolean;
  path: string;
  comments: DiffCommentsController;
  headSHA: string;
  byAnchor: Map<string, InlineComment[]>;
  canComment: boolean;
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  viewerLogin?: string;
};

function HunkRows({
  hunk,
  hunkKey,
  changes,
  flash,
  path,
  comments,
  headSHA,
  byAnchor,
  canComment,
  draft,
  onDraftChange,
  viewerLogin,
}: HunkRowsProps) {
  const [open, setOpen] = useState(false);
  const tally = changes.length > 0 ? tallyChanges(changes) : null;
  const dominant = tally?.dominant;

  return (
    <>
      <div
        data-diff-hunk={hunkKey}
        className={`${ROW_GRID} scroll-mt-[36px] bg-surface ${
          flash ? "outline outline-1 -outline-offset-1 outline-accent/50" : ""
        }`}
      >
        <span className="border-r border-line select-none" />
        <span className="border-r border-line select-none" />
        <span className="border-r border-line select-none" />
        <span className="flex min-w-0 items-center gap-2 px-3 py-1 text-fg-faint select-none">
          <span className="min-w-0 truncate">
            {hunk.header}
            {hunk.section ? (
              <span className="pl-2 text-fg-muted">{hunk.section}</span>
            ) : null}
          </span>
          {dominant ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              aria-label={`${tallyText(tally)} in this hunk`}
              title={`${tallyText(tally)} · ${
                changes.length
              } semantic ${changes.length === 1 ? "change" : "changes"}`}
              className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[3px] border bg-canvas px-1.5 font-sans text-micro transition-colors hover:bg-surface ${badgeClassName(
                dominant,
              )}`}
            >
              {changeMark(dominant).mark} {changes.length}
              <ChevronDown
                className={`size-3 transition-transform ${
                  open ? "" : "-rotate-90"
                }`}
                aria-hidden
              />
            </button>
          ) : null}
        </span>
      </div>
      {open && changes.length > 0 ? (
        <div className="border-b border-line pb-1">
          {changes.map((change, index) => (
            <ChangeAnnotation
              key={`${change.entityType}:${change.entityName}:${index}`}
              change={change}
              filePath={path}
            />
          ))}
        </div>
      ) : null}
      {hunk.lines.map((line, index) => {
        const anchor = lineAnchor(path, line);
        const anchorComments = lineAnchors(path, line)
          .flatMap((item) => byAnchor.get(anchorKey(item)) ?? [])
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return (
          <LineRow
            key={index}
            line={line}
            anchor={anchor}
            anchorComments={anchorComments}
            canComment={canComment}
            draft={draft}
            onDraftChange={onDraftChange}
            comments={comments}
            headSHA={headSHA}
            viewerLogin={viewerLogin}
          />
        );
      })}
    </>
  );
}

type LineRowProps = {
  line: DiffLine;
  anchor: CommentAnchor | null;
  anchorComments: InlineComment[];
  canComment: boolean;
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  comments: DiffCommentsController;
  headSHA: string;
  viewerLogin?: string;
};

function LineRow({
  line,
  anchor,
  anchorComments,
  canComment,
  draft,
  onDraftChange,
  comments,
  headSHA,
  viewerLogin,
}: LineRowProps) {
  const gutter =
    "select-none border-r border-line px-2 text-right text-fg-faint";
  const key = anchor ? anchorKey(anchor) : null;
  const composing = key !== null && draft === key;

  return (
    <>
      <div className={`group ${ROW_GRID} ${rowTint(line.kind)}`}>
        <span className="flex items-center justify-center border-r border-line select-none">
          {anchor && canComment ? (
            <button
              type="button"
              onClick={() => onDraftChange(composing ? null : key)}
              aria-label={composing ? "Cancel comment" : "Comment on this line"}
              title={composing ? "Cancel comment" : "Comment on this line"}
              className="flex size-5 items-center justify-center rounded-[3px] text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface hover:text-fg focus-visible:opacity-100"
            >
              <MessageSquarePlus className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </span>
        <span className={gutter}>{line.oldNumber || ""}</span>
        <span className={gutter}>{line.newNumber || ""}</span>
        <span className={`${codeClasses(line.kind)} pr-3 pl-3 whitespace-pre`}>
          {line.spans && line.spans.length > 0
            ? line.spans.map((span, index) => (
                <span
                  key={index}
                  className={spanClasses(line.kind, span) || undefined}
                >
                  {span.text}
                </span>
              ))
            : line.text || " "}
        </span>
      </div>

      {anchorComments.length > 0 ? (
        <div className="border-b border-line bg-surface/40 px-3 py-2">
          {anchorComments.map((comment) => (
            <InlineCommentRow
              key={comment.id}
              comment={comment}
              comments={comments}
              canDelete={
                viewerLogin !== undefined &&
                viewerLogin !== "" &&
                comment.author.toLowerCase() === viewerLogin.toLowerCase()
              }
            />
          ))}
        </div>
      ) : null}

      {composing && anchor ? (
        <div className="border-b border-line bg-surface/40 px-3 py-2">
          <CommentComposer
            anchor={anchor}
            headSHA={headSHA}
            comments={comments}
            onDone={() => onDraftChange(null)}
          />
        </div>
      ) : null}
    </>
  );
}

type InlineCommentRowProps = {
  comment: InlineComment;
  comments: DiffCommentsController;
  canDelete: boolean;
};

function InlineCommentRow({
  comment,
  comments,
  canDelete,
}: InlineCommentRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reply = comment.inReplyToID !== undefined;
  const deleting = comments.deletingID === comment.id;

  async function remove() {
    setError(null);
    const failure = await comments.remove(comment.id);
    if (failure) {
      setError(failure);
      setConfirming(false);
    }
  }

  return (
    <article
      className={`group border-line py-2 first:pt-0 last:pb-0 ${
        reply ? "mt-2 border-l-2 pl-3" : "border-b last:border-b-0"
      }`}
    >
      <div className="flex items-center gap-2 text-meta">
        <span className="font-medium text-fg">{comment.author}</span>
        {reply ? <span className="text-micro text-fg-faint">reply</span> : null}
        <span className="tabular text-fg-faint">
          {formatRelative(comment.createdAt)}
        </span>
        {canDelete && !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleting}
            className="ml-auto text-micro text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100 disabled:opacity-50"
          >
            Delete
          </button>
        ) : null}
      </div>
      <div className="mt-1 max-w-3xl">
        <Markdown>{comment.body}</Markdown>
      </div>

      {confirming ? (
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => void remove()}
            disabled={deleting}
            className="text-danger hover:bg-danger/10 hover:text-danger"
          >
            {deleting ? "Deleting…" : "Delete comment"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            disabled={deleting}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </article>
  );
}

type CommentComposerProps = {
  anchor: CommentAnchor;
  headSHA: string;
  comments: DiffCommentsController;
  onDone: () => void;
};

function CommentComposer({
  anchor,
  headSHA,
  comments,
  onDone,
}: CommentComposerProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = body.trim();
    if (!text || comments.pending) return;
    setError(null);
    const failure = await comments.submit({
      body: text,
      path: anchor.path,
      line: anchor.line,
      side: anchor.side,
      commitId: headSHA,
    });
    if (failure) {
      setError(failure);
      return;
    }
    onDone();
  }

  return (
    <div className="max-w-3xl">
      <label
        htmlFor={`inline-comment-${anchor.side}-${anchor.line}`}
        className="sr-only"
      >
        Comment on line {anchor.line}
      </label>
      <textarea
        id={`inline-comment-${anchor.side}-${anchor.line}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!comments.pending) onDone();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        rows={3}
        autoFocus
        placeholder="Leave a comment on this line…"
        className="w-full resize-y rounded-[4px] border border-line bg-canvas px-2 py-1.5 text-prose text-fg placeholder:text-fg-faint"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={comments.pending || body.trim() === ""}
        >
          {comments.pending ? "Posting…" : "Comment"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={comments.pending}>
          Cancel
        </Button>
        <span className="ml-auto text-micro text-fg-faint">⌘↵ to post</span>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function rowTint(kind: DiffLine["kind"]): string {
  if (kind === "add") return "bg-diff-add-line";
  if (kind === "del") return "bg-diff-del-line";
  return "";
}

function codeClasses(kind: DiffLine["kind"]): string {
  if (kind === "add") return "text-fg";
  if (kind === "del") return "text-fg-body";
  return "text-fg-muted";
}

function emphasisClasses(kind: DiffLine["kind"]): string {
  return kind === "del" ? "bg-diff-del-word" : "bg-diff-add-word";
}

const SYNTAX_CLASS: Record<NonNullable<DiffSpan["kind"]>, string> = {
  keyword: "text-syn-keyword",
  string: "text-syn-string",
  number: "text-syn-number",
  comment: "text-syn-comment italic",
  func: "text-syn-func",
  tag: "text-syn-tag",
  type: "text-syn-type",
  // Constants share the number hue; variable/property stay regular text.
  builtin: "text-syn-number",
  variable: "",
  property: "",
};

function spanClasses(kind: DiffLine["kind"], span: DiffSpan): string {
  const classes: string[] = [];
  const syntax = span.kind ? SYNTAX_CLASS[span.kind] : "";
  if (syntax) classes.push(syntax);
  if (span.emph) classes.push(emphasisClasses(kind));
  return classes.join(" ");
}

/** Fallback for patches the backend could not structure. */
function RawPatch({ patch }: { patch: string }) {
  const hunks = parsePatch(patch);
  if (hunks.length === 0) {
    return (
      <p className="border-t border-line bg-canvas px-3 py-2 text-meta text-fg-faint">
        No textual changes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-line bg-canvas">
      <div className="min-w-max font-mono text-code">
        {hunks.map((hunk, index) => (
          <div key={`${hunk.header}:${index}`}>
            <div className={lineClasses(hunk.header)}>{hunk.header || " "}</div>
            {hunk.lines.map((line, lineIndex) => (
              <div key={lineIndex} className={lineClasses(line)}>
                {line || " "}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangeAnnotation({
  change,
  filePath,
}: {
  change: SemanticChange;
  filePath: string;
}) {
  const moved =
    change.changeType === "moved" || change.changeType === "renamed";
  const source =
    change.oldFilePath && change.oldFilePath !== filePath
      ? change.oldFilePath
      : null;
  const mark = changeMark(change);

  return (
    <div className="flex items-center gap-2 px-3 py-1 font-sans text-meta">
      <span
        className={`w-4 shrink-0 rounded-[3px] border text-center text-micro leading-4 ${badgeClassName(
          change,
        )}`}
        title={change.changeType}
      >
        {mark.mark}
      </span>
      <span className="shrink-0 text-fg-faint">{change.entityType}</span>
      <span
        className={`truncate ${
          change.cosmetic ? "text-fg-faint" : "text-fg-body"
        }`}
      >
        {change.entityName}
      </span>
      {moved ? (
        <span className="truncate text-micro text-fg-faint">
          {source
            ? `from ${source}`
            : change.oldEntityName
              ? `was ${change.oldEntityName}`
              : "moved"}
        </span>
      ) : null}
      {change.cosmetic ? (
        <span className="shrink-0 text-micro tracking-[0.06em] text-fg-faint uppercase">
          cosmetic
        </span>
      ) : null}
    </div>
  );
}

function lineClasses(line: string): string {
  if (line.startsWith("@@")) {
    return "bg-surface px-3 py-1 text-fg-faint";
  }
  if (line.startsWith("+")) {
    return "border-l-2 border-l-accent/40 bg-diff-add-line px-3 text-fg";
  }
  if (line.startsWith("-")) {
    return "border-l-2 border-l-danger/40 bg-diff-del-line pr-3 pl-[10px] text-fg-body";
  }
  return "border-l-2 border-l-transparent px-3 text-fg-muted";
}
