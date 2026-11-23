import type { ReactNode, RefObject } from "react";
import type { WalkthroughStep } from "../../../lib/types";
import { DiffRailList } from "./DiffRailList";
import { DiffSidebarFilters } from "./DiffSidebarFilters";
import type { DiffFileEntry, DiffSelection } from "./diffSelection";
import { filesSummary, stepsSummary } from "./diffSelection";

/** The rail frame: fixed width, one scroller, and the footer count line. */
function Rail({
  label,
  footer,
  children,
}: {
  label: string;
  footer: string;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="flex shrink-0 flex-col border-r border-line"
      style={{ width: "var(--diff-rail, 208px)" }}
    >
      {children}
      <div className="shrink-0 border-t border-line p-2 font-mono text-micro text-fg-faint tabular-nums">
        {footer}
      </div>
    </aside>
  );
}

/** The file list: search and filters above the rows. */
export function FileRail({
  files,
  totalCount,
  activeKey,
  filter,
  filterInputRef,
  railRef,
  edgeClassName,
  selection,
  onFilterChange,
  onSelect,
}: {
  /** Rail files, after every filter and the path search. */
  files: DiffFileEntry[];
  /** Every file in the diff, before kinds, cosmetic, priority and search. */
  totalCount: number;
  activeKey: string | null;
  filter: string;
  filterInputRef: RefObject<HTMLInputElement | null>;
  /** The rail's row scroller, so the owner can attach scroll-edge fades. */
  railRef: RefObject<HTMLDivElement | null>;
  /** Clipped-edge fade for the row scroller. */
  edgeClassName: string;
  /** Counts for the filters and the footer, computed once for the whole diff. */
  selection: DiffSelection;
  onFilterChange: (value: string) => void;
  onSelect: (key: string) => void;
}) {
  return (
    <Rail
      label="Files in this pull request"
      footer={filesSummary(
        files.length,
        totalCount,
        totalCount - files.length,
        selection.highCount,
      )}
    >
      <DiffSidebarFilters
        filter={filter}
        filterInputRef={filterInputRef}
        kindCounts={selection.kindCounts}
        hasReview={selection.hasReview}
        lowCount={selection.lowCount}
        onFilterChange={onFilterChange}
        onSelectFirst={() => {
          const first = files[0];
          if (first) onSelect(first.key);
        }}
      />

      <DiffRailList
        files={files}
        activeKey={activeKey}
        onSelect={onSelect}
        onScrollerRef={(node) => {
          railRef.current = node;
        }}
        edgeClassName={edgeClassName}
      />
    </Rail>
  );
}

/** The review path: one row per walkthrough step, with no filters. */
export function PathRail({
  steps,
  activeStepID,
  railRef,
  edgeClassName,
  onSelectStep,
}: {
  steps: WalkthroughStep[];
  activeStepID?: string;
  /** The rail's row scroller, so the owner can attach scroll-edge fades. */
  railRef: RefObject<HTMLDivElement | null>;
  /** Clipped-edge fade for the row scroller. */
  edgeClassName: string;
  onSelectStep: (stepID: string) => void;
}) {
  return (
    <Rail label="Review path" footer={stepsSummary(steps.length)}>
      <DiffRailList
        steps={steps}
        activeStepID={activeStepID}
        onSelectStep={onSelectStep}
        onScrollerRef={(node) => {
          railRef.current = node;
        }}
        edgeClassName={edgeClassName}
      />
    </Rail>
  );
}
