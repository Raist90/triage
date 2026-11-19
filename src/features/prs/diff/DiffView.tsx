import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cx } from "../../../lib/cx";
import type {
  DiffFile,
  SemanticSummary,
  Walkthrough,
} from "../../../lib/types";
import { scrollEdgeClass, useScrollEdges } from "../../../lib/useScrollEdges";
import { useUIStore } from "../../../stores/ui";
import { DiffFileSection } from "./DiffFileSection";
import { selectDiffFiles, type DiffTarget } from "./diffSelection";
import { DiffSidebar } from "./DiffSidebar";
import { DiffToolbar } from "./DiffToolbar";
import { SemanticRail } from "./SemanticRail";
import type { DiffCommentsController } from "./useDiffComments";
import { useDiffNavigation } from "./useDiffNavigation";
import { useResizableRail } from "./useResizableRail";
import { pathEntries } from "./walkthrough";
import type { PathFileEntry } from "./walkthrough";

export type { DiffTarget } from "./diffSelection";

type DiffViewProps = {
  files: DiffFile[];
  semanticAvailable: boolean;
  semanticSummary?: SemanticSummary;
  walkthrough?: Walkthrough;
  comments: DiffCommentsController;
  headSHA: string;
  canComment: boolean;
  viewerLogin?: string;
  /** Open this file and hunk once. The token re-triggers the same target. */
  focusTarget?: DiffTarget;
};

export function DiffView({
  files,
  semanticAvailable,
  semanticSummary,
  walkthrough,
  comments,
  headSHA,
  canComment,
  viewerLogin,
  focusTarget,
}: DiffViewProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [hideCosmetic, setHideCosmetic] = useState(true);
  const [filter, setFilter] = useState("");

  const hiddenKinds = useUIStore((state) => state.hiddenFileKinds);
  const toggleFileKind = useUIStore((state) => state.toggleFileKind);
  const clearFileKinds = useUIStore((state) => state.clearFileKinds);
  const diffSort = useUIStore((state) => state.diffSort);
  const setDiffSort = useUIStore((state) => state.setDiffSort);
  const hideLowPriority = useUIStore((state) => state.hideLowPriority);
  const toggleLowPriority = useUIStore((state) => state.toggleLowPriority);
  const showSemanticRail = useUIStore((state) => state.showSemanticRail);
  const toggleSemanticRail = useUIStore((state) => state.toggleSemanticRail);
  const diffMode = useUIStore((state) => state.diffMode);
  const setDiffMode = useUIStore((state) => state.setDiffMode);

  // Filters and the priority sort are pure but O(files); a selection render
  // must not recompute them.
  const selection = useMemo(
    () =>
      selectDiffFiles(files, {
        hiddenKinds,
        hideCosmetic,
        hideLowPriority,
        sort: diffSort,
      }),
    [files, hiddenKinds, hideCosmetic, hideLowPriority, diffSort],
  );
  const {
    kindCounts,
    hiddenByKind,
    kindFiltered,
    cosmeticFiles,
    hasReview,
    highCount,
    lowCount,
    hiddenCount,
    visible,
    visibleSignature,
  } = selection;

  const [activeStepID, setActiveStepID] = useState<string | null>(null);
  const activeStep =
    walkthrough?.steps.find((step) => step.id === activeStepID) ??
    walkthrough?.steps[0];
  const pathFiles = useMemo(
    () => pathEntries(files, activeStep),
    [files, activeStep],
  );
  const hasPath = (walkthrough?.steps.length ?? 0) > 0;
  const pathMode = diffMode === "path" && hasPath;
  const displayEntries = pathMode ? pathFiles : visible;
  const displaySignature = pathMode
    ? `${activeStep?.id ?? ""}\u0000${pathFiles.map((entry) => entry.key).join("\u0000")}`
    : visibleSignature;
  const displayFirstKey = displayEntries[0]?.key ?? null;

  const {
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
    expandFiles,
    handleScroll,
    releaseScrollLock,
  } = useDiffNavigation({
    visible: displayEntries,
    visibleSignature: displaySignature,
    firstVisibleKey: displayFirstKey,
    focusTarget,
  });

  // Read inside the step effect: toggling focus mode must not look like a step
  // change and reset the pane.
  const focusModeRef = useRef(focusMode);
  useEffect(() => {
    focusModeRef.current = focusMode;
  }, [focusMode]);

  // A step is a commit. Opening it shows its files together, except in focus
  // mode, which keeps one file at a time. The user can collapse any of them
  // afterwards.
  const stepID = activeStep?.id;
  useEffect(() => {
    if (!pathMode) return;
    const keys = pathFiles.map((entry) => entry.key);
    const first = keys[0];
    if (focusModeRef.current && first !== undefined) {
      selectFile(first);
    } else {
      expandFiles(keys);
    }
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [pathMode, stepID, pathFiles, expandFiles, selectFile, paneRef]);

  const scrollEdges = useScrollEdges(paneRef);
  const { width: railWidth, rootRef, separatorProps } = useResizableRail();

  const railLayoutKey = useMemo(
    () =>
      displayEntries
        .map(
          ({ key, file }) =>
            `${key}:${expanded.has(key) ? "open" : "closed"}:${file.semantic?.length ?? 0}`,
        )
        .join("\u0000"),
    [displayEntries, expanded],
  );
  const hasSemantic = useMemo(
    () =>
      semanticAvailable &&
      files.some((file) => (file.semantic?.length ?? 0) > 0),
    [semanticAvailable, files],
  );
  const visibleSemantic = useMemo(
    () =>
      hasSemantic &&
      displayEntries.some(({ file }) => (file.semantic?.length ?? 0) > 0),
    [hasSemantic, displayEntries],
  );
  const showSummary = semanticAvailable && (semanticSummary?.total ?? 0) > 0;

  // Stable registration so a memoized section owns its own ref callback.
  const onSectionRef = useCallback(
    (key: string, element: HTMLElement | null) => {
      if (element) sectionRefs.current.set(key, element);
      else sectionRefs.current.delete(key);
    },
    [sectionRefs],
  );

  // Only the section that owns the open composer needs the draft key. The key
  // is `${path}\u0000${side}\u0000${line}`.
  const draftSeparator = draft === null ? -1 : draft.indexOf("\u0000");
  const draftPath =
    draft !== null && draftSeparator >= 0
      ? draft.slice(0, draftSeparator)
      : null;

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col"
      style={{ "--diff-rail": `${railWidth}px` } as CSSProperties}
    >
      <DiffToolbar
        summary={semanticSummary}
        showSummary={showSummary}
        highCount={highCount}
        cosmeticFiles={cosmeticFiles}
        hiddenByKind={hiddenByKind}
        hideLowPriority={hideLowPriority}
        lowCount={lowCount}
        focusMode={focusMode}
        hideCosmetic={hideCosmetic}
        hasSemantic={hasSemantic}
        showSemanticRail={showSemanticRail}
        pathMode={pathMode}
        hasPath={hasPath}
        stepLabel={
          activeStep && walkthrough
            ? `Step ${walkthrough.steps.indexOf(activeStep) + 1} of ${walkthrough.steps.length} · ${activeStep.title}`
            : undefined
        }
        onTogglePathMode={() => setDiffMode(pathMode ? "files" : "path")}
        onToggleFocusMode={toggleFocusMode}
        onToggleHideCosmetic={() => setHideCosmetic((current) => !current)}
        onToggleSemanticRail={toggleSemanticRail}
        onClearFileKinds={clearFileKinds}
      />

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
          mode={diffMode}
          walkthrough={walkthrough}
          activeStepID={activeStep?.id}
          hideLowPriority={hideLowPriority}
          lowCount={lowCount}
          onSelectStep={setActiveStepID}
          onSortChange={setDiffSort}
          onToggleLowPriority={toggleLowPriority}
          onFilterChange={setFilter}
          onToggleKind={toggleFileKind}
          onSelect={selectFile}
        />

        <div
          {...separatorProps}
          className="-ml-1 w-2 shrink-0 cursor-col-resize touch-none"
        />

        <div
          ref={paneRef}
          onScroll={handleScroll}
          onWheel={releaseScrollLock}
          onTouchStart={releaseScrollLock}
          onPointerDown={releaseScrollLock}
          className={cx(
            "min-w-0 flex-1 overflow-y-auto",
            scrollEdgeClass(scrollEdges),
          )}
        >
          {displayEntries.length === 0 ? (
            pathMode ? (
              <p className="border-b border-line p-3 text-meta text-fg-faint">
                This step has no renderable hunks.
              </p>
            ) : kindFiltered.length === 0 ? (
              <p className="border-b border-line p-3 text-meta text-fg-faint">
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
              <p className="border-b border-line p-3 text-meta text-fg-faint">
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

          {displayEntries.map((entry) => {
            const hunks = pathMode ? (entry as PathFileEntry).hunks : undefined;
            return (
              <DiffFileSection
                key={entry.key}
                file={entry.file}
                fileKey={entry.key}
                hunks={hunks}
                open={expanded.has(entry.key)}
                onToggle={toggleFile}
                onSectionRef={onSectionRef}
                comments={comments}
                headSHA={headSHA}
                canComment={canComment}
                draft={draftPath === entry.file.path ? draft : null}
                onDraftChange={setDraft}
                viewerLogin={viewerLogin}
                flash={
                  flash !== null && flash.key === entry.key ? flash.label : null
                }
              />
            );
          })}
        </div>

        {visibleSemantic && showSemanticRail ? (
          <SemanticRail
            paneRef={paneRef}
            files={displayEntries}
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
