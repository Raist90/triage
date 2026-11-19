import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { cx } from "../../../lib/cx";
import type { DiffFile, SemanticSummary } from "../../../lib/types";
import { scrollEdgeClass, useScrollEdges } from "../../../lib/useScrollEdges";
import { useUIStore } from "../../../stores/ui";
import { DiffCommentsProvider } from "./DiffCommentsProvider";
import { DiffFileSection } from "./DiffFileSection";
import { selectDiffFiles, type DiffTarget } from "./diffSelection";
import { DiffSidebar } from "./DiffSidebar";
import { DiffToolbar } from "./DiffToolbar";
import { SemanticRail } from "./SemanticRail";
import type { DiffCommentsController } from "./useDiffComments";
import { useDiffNavigation } from "./useDiffNavigation";
import { useResizableRail } from "./useResizableRail";

export type { DiffTarget } from "./diffSelection";

type DiffViewProps = {
  files: DiffFile[];
  semanticAvailable: boolean;
  semanticSummary?: SemanticSummary;
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
    firstVisibleKey,
    visibleSignature,
  } = selection;

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
    handleScroll,
    releaseScrollLock,
  } = useDiffNavigation({
    visible,
    visibleSignature,
    firstVisibleKey,
    focusTarget,
  });

  const scrollEdges = useScrollEdges(paneRef);
  const { width: railWidth, rootRef, separatorProps } = useResizableRail();

  const railLayoutKey = useMemo(
    () =>
      visible
        .map(
          ({ key, file }) =>
            `${key}:${expanded.has(key) ? "open" : "closed"}:${file.semantic?.length ?? 0}`,
        )
        .join("\u0000"),
    [visible, expanded],
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
      visible.some(({ file }) => (file.semantic?.length ?? 0) > 0),
    [hasSemantic, visible],
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

  // The review surface is fixed for this diff, so the sections below read it
  // from context rather than through props. One stable identity keeps a
  // selection or jump from waking every memoized section.
  const commentsValue = useMemo(
    () => ({ comments, headSHA, canComment, viewerLogin }),
    [comments, headSHA, canComment, viewerLogin],
  );

  // Only the section that owns the open composer needs the draft key. The key
  // is `${path}\u0000${side}\u0000${line}`.
  const draftSeparator = draft === null ? -1 : draft.indexOf("\u0000");
  const draftPath =
    draft !== null && draftSeparator >= 0
      ? draft.slice(0, draftSeparator)
      : null;

  return (
    <DiffCommentsProvider value={commentsValue}>
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
            hideLowPriority={hideLowPriority}
            lowCount={lowCount}
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
            {visible.length === 0 ? (
              kindFiltered.length === 0 ? (
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

            {visible.map(({ file, key }) => (
              <DiffFileSection
                key={key}
                file={file}
                fileKey={key}
                open={expanded.has(key)}
                onToggle={toggleFile}
                onSectionRef={onSectionRef}
                draft={draftPath === file.path ? draft : null}
                onDraftChange={setDraft}
                flash={flash !== null && flash.key === key ? flash.label : null}
              />
            ))}
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
    </DiffCommentsProvider>
  );
}
