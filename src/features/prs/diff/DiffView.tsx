import { useCallback, useEffect, useMemo, useState } from "react";
import { cx } from "../../../lib/cx";
import type { DiffFile, PR, Walkthrough } from "../../../lib/types";
import { scrollEdgeClass, useScrollEdges } from "../../../lib/useScrollEdges";
import { useUIStore } from "../../../stores/ui";
import { DiffCommentsContext } from "./DiffCommentsContext";
import { DiffFileSection } from "./DiffFileSection";
import { DiffFilesPopover } from "./DiffFilesPopover";
import {
  filterDiffEntries,
  selectDiffFiles,
  type DiffTarget,
} from "./diffSelection";
import { DiffStrip } from "./DiffStrip";
import { SemanticRail } from "./SemanticRail";
import type { DiffCommentsController } from "./useDiffComments";
import { useDiffNavigation } from "./useDiffNavigation";
import { pathEntries } from "./walkthrough";
import type { PathFileEntry } from "./walkthrough";

export type { DiffTarget } from "./diffSelection";

type DiffViewProps = {
  pr: PR;
  files: DiffFile[];
  semanticAvailable: boolean;
  walkthrough?: Walkthrough;
  comments: DiffCommentsController;
  headSHA: string;
  canComment: boolean;
  viewerLogin?: string;
  /** Open this file and hunk once. The token re-triggers the same target. */
  focusTarget?: DiffTarget;
  /** Bumped by "Open diff" so the pane scrolls back to the start. */
  revealToken?: number;
};

/**
 * One scroll: the strip, then every file as a 44px sticky header. The old file
 * rail is gone; its search, filters and walkthrough live in the Files popover.
 */
export function DiffView({
  pr,
  files,
  semanticAvailable,
  walkthrough,
  comments,
  headSHA,
  canComment,
  viewerLogin,
  focusTarget,
  revealToken,
}: DiffViewProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [hideCosmetic, setHideCosmetic] = useState(true);
  const [filter, setFilter] = useState("");
  const [focusMode, setFocusMode] = useState(true);
  const [openFilesRequest, setOpenFilesRequest] = useState(0);
  const openFiles = useCallback(
    () => setOpenFilesRequest((current) => current + 1),
    [],
  );

  const hiddenKinds = useUIStore((state) => state.hiddenFileKinds);
  const clearFileKinds = useUIStore((state) => state.clearFileKinds);
  const diffSort = useUIStore((state) => state.diffSort);
  const hideLowPriority = useUIStore((state) => state.hideLowPriority);
  const showSemanticRail = useUIStore((state) => state.showSemanticRail);
  const toggleSemanticRail = useUIStore((state) => state.toggleSemanticRail);
  const showDiffComments = useUIStore((state) => state.showDiffComments);
  const toggleDiffComments = useUIStore((state) => state.toggleDiffComments);
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
  const { kindFiltered, visible } = selection;

  // Search narrows the popover list and the keyboard walk, never the pane:
  // typing must not close the patch being reviewed.
  const matched = useMemo(
    () => filterDiffEntries(visible, filter),
    [visible, filter],
  );

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
  const paneEntries = pathMode ? pathFiles : visible;
  const navEntries = pathMode ? pathFiles : matched;
  const navSignature = pathMode
    ? `${activeStep?.id ?? ""}\u0000${pathFiles.map((entry) => entry.key).join("\u0000")}`
    : matched.map((entry) => entry.key).join("\u0000");
  const navFirstKey = navEntries[0]?.key ?? null;
  const stepNavigation = pathMode
    ? {
        ids: walkthrough?.steps.map((step) => step.id) ?? [],
        activeID: activeStep?.id ?? null,
        onSelect: setActiveStepID,
      }
    : undefined;

  const {
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
  } = useDiffNavigation({
    visible: navEntries,
    visibleSignature: navSignature,
    firstVisibleKey: navFirstKey,
    focusModeApplies: !pathMode,
    focusMode,
    openFilter: openFiles,
    stepNavigation,
    focusTarget,
  });

  // A step is a commit, so opening it always shows its files together. Focus
  // mode is a file-list policy and does not apply here; the user can still
  // collapse individual files afterwards.
  const stepID = activeStep?.id;
  useEffect(() => {
    if (!pathMode) return;
    expandFiles(pathFiles.map((entry) => entry.key));
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [pathMode, stepID, pathFiles, expandFiles, paneRef]);

  // "Open diff" from the hero lands at the top of the code.
  useEffect(() => {
    if (revealToken === undefined || !paneRef.current) return;
    paneRef.current.scrollTop = 0;
  }, [revealToken, paneRef]);

  const scrollEdges = useScrollEdges(paneRef);

  const railLayoutKey = useMemo(
    () =>
      paneEntries
        .map(
          ({ key, file }) =>
            `${key}:${expanded.has(key) ? "open" : "closed"}:${file.semantic?.length ?? 0}`,
        )
        .join("\u0000"),
    [paneEntries, expanded],
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
      paneEntries.some(({ file }) => (file.semantic?.length ?? 0) > 0),
    [hasSemantic, paneEntries],
  );

  const commentsValue = useMemo(
    () => ({
      comments,
      headSHA,
      canComment,
      viewerLogin,
      showComments: showDiffComments,
    }),
    [comments, headSHA, canComment, viewerLogin, showDiffComments],
  );

  // Stable registration so a memoized section owns its own ref callback.
  const onSectionRef = (key: string, element: HTMLElement | null) => {
    if (element) sectionRefs.current.set(key, element);
    else sectionRefs.current.delete(key);
  };

  // Only the section that owns the open composer needs the draft key. The key
  // is `${path}\u0000${side}\u0000${line}`.
  const draftSeparator = draft === null ? -1 : draft.indexOf("\u0000");
  const draftPath =
    draft !== null && draftSeparator >= 0
      ? draft.slice(0, draftSeparator)
      : null;

  return (
    <DiffCommentsContext value={commentsValue}>
      <div className="flex h-full min-h-0 flex-col">
        <DiffStrip
          pr={pr}
          selection={selection}
          showComments={showDiffComments}
          onToggleComments={toggleDiffComments}
          hideCosmetic={hideCosmetic}
          openRequest={openFilesRequest}
          onToggleHideCosmetic={() => setHideCosmetic((current) => !current)}
          renderFilesPopover={(close) => (
            <DiffFilesPopover
              files={files}
              matched={matched}
              selection={selection}
              filter={filter}
              filterInputRef={filterInputRef}
              activeKey={activeKey}
              focusMode={focusMode}
              hasSemantic={hasSemantic}
              showSemanticRail={showSemanticRail}
              hasPath={hasPath}
              pathMode={pathMode}
              steps={walkthrough?.steps ?? []}
              activeStepID={activeStep?.id}
              onFilterChange={setFilter}
              onSelectFile={selectFile}
              onSelectStep={setActiveStepID}
              onToggleFocusMode={() => setFocusMode((current) => !current)}
              onTogglePathMode={() => setDiffMode(pathMode ? "files" : "path")}
              onToggleSemanticRail={toggleSemanticRail}
              onClearFileKinds={clearFileKinds}
              onClose={close}
            />
          )}
        />

        <div className="flex min-h-0 flex-1">
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
            {paneEntries.length === 0 ? (
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

            {paneEntries.map((entry) => {
              const hunks = pathMode
                ? (entry as PathFileEntry).hunks
                : undefined;
              return (
                <DiffFileSection
                  key={entry.key}
                  file={entry.file}
                  fileKey={entry.key}
                  hunks={hunks}
                  open={expanded.has(entry.key)}
                  onToggle={toggleFile}
                  onSectionRef={onSectionRef}
                  draft={draftPath === entry.file.path ? draft : null}
                  onDraftChange={setDraft}
                  flash={
                    flash !== null && flash.key === entry.key
                      ? flash.label
                      : null
                  }
                />
              );
            })}
          </div>

          {visibleSemantic && showSemanticRail ? (
            <SemanticRail
              paneRef={paneRef}
              files={paneEntries}
              expanded={expanded}
              singleFile={!pathMode && focusMode}
              layoutKey={railLayoutKey}
              onJump={selectHunk}
            />
          ) : null}
        </div>
      </div>
    </DiffCommentsContext>
  );
}
