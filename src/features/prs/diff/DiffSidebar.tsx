import type { RefObject } from "react";
import type { DiffFileKind, WalkthroughStep } from "../../../lib/types";
import type { DiffSort } from "../../../stores/ui";
import { DiffRailList } from "./DiffRailList";
import { DiffSidebarFilters } from "./DiffSidebarFilters";
import type { DiffFileEntry } from "./diffSelection";
import { filesSummary, stepsSummary } from "./diffSelection";

export function DiffSidebar({
  files,
  activeKey,
  filter,
  filterInputRef,
  kindCounts,
  hiddenKinds,
  totalCount,
  hiddenCount,
  highCount,
  hasReview,
  sort,
  steps,
  activeStepID,
  hideLowPriority,
  lowCount,
  onSelectStep,
  onSortChange,
  onToggleLowPriority,
  onFilterChange,
  onToggleKind,
  onSelect,
}: {
  /** Rail files, after every filter and the path search. */
  files: DiffFileEntry[];
  activeKey: string | null;
  filter: string;
  filterInputRef: RefObject<HTMLInputElement | null>;
  kindCounts: Record<DiffFileKind, number>;
  hiddenKinds: DiffFileKind[];
  /** Every file in the diff, before kinds, cosmetic, priority and search. */
  totalCount: number;
  /** Files the rail is not showing, for any reason. */
  hiddenCount: number;
  /** High-focus files across the whole diff, as scored by the backend. */
  highCount: number;
  /** True when the backend scored the files and ranking is meaningful. */
  hasReview: boolean;
  sort: DiffSort;
  /** Resolved by the parent; presence switches the rail to path mode. */
  steps?: WalkthroughStep[];
  activeStepID?: string;
  hideLowPriority: boolean;
  lowCount: number;
  onSelectStep: (stepID: string) => void;
  onSortChange: (sort: DiffSort) => void;
  onToggleLowPriority: () => void;
  onFilterChange: (value: string) => void;
  onToggleKind: (kind: DiffFileKind) => void;
  onSelect: (key: string) => void;
}) {
  return (
    <aside
      aria-label={steps ? "Review path" : "Files in this pull request"}
      className="flex shrink-0 flex-col border-r border-line"
      style={{ width: "var(--diff-rail, 208px)" }}
    >
      {steps ? null : (
        <DiffSidebarFilters
          filter={filter}
          filterInputRef={filterInputRef}
          kindCounts={kindCounts}
          hiddenKinds={hiddenKinds}
          hasReview={hasReview}
          sort={sort}
          hideLowPriority={hideLowPriority}
          lowCount={lowCount}
          onFilterChange={onFilterChange}
          onToggleKind={onToggleKind}
          onSortChange={onSortChange}
          onToggleLowPriority={onToggleLowPriority}
          onSelectFirst={() => {
            const first = files[0];
            if (first) onSelect(first.key);
          }}
        />
      )}

      <DiffRailList
        files={files}
        steps={steps}
        activeKey={activeKey}
        activeStepID={activeStepID}
        onSelectStep={onSelectStep}
        onSelect={onSelect}
      />

      <div className="shrink-0 border-t border-line p-2 font-mono text-micro text-fg-faint tabular-nums">
        {steps
          ? stepsSummary(steps.length)
          : filesSummary(files.length, totalCount, hiddenCount, highCount)}
      </div>
    </aside>
  );
}
