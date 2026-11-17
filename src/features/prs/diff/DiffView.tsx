import { useState } from "react";
import { cx } from "../../../lib/cx";
import type { DiffFile, SemanticSummary } from "../../../lib/types";
import { scrollEdgeClass, useScrollEdges } from "../../../lib/useScrollEdges";
import { useUIStore } from "../../../stores/ui";
import { DiffFileSection } from "./DiffFileSection";
import { selectDiffFiles, type DiffTarget } from "./diffSelection";
import { DiffSidebar } from "./DiffSidebar";
import { DiffToolbar } from "./DiffToolbar";
import { SemanticRail } from "./SemanticRail";
import type { DiffCommentsController } from "./useDiffComments";
import { useDiffNavigation } from "./useDiffNavigation";

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
  } = selectDiffFiles(files, {
    hiddenKinds,
    hideCosmetic,
    hideLowPriority,
    sort: diffSort,
  });

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
  const showSummary = semanticAvailable && (semanticSummary?.total ?? 0) > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
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
              onToggle={() => toggleFile(key)}
              sectionRef={(element) => {
                if (element) sectionRefs.current.set(key, element);
                else sectionRefs.current.delete(key);
              }}
              comments={comments}
              headSHA={headSHA}
              canComment={canComment}
              draft={draft}
              onDraftChange={setDraft}
              viewerLogin={viewerLogin}
              flash={flash}
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
  );
}
