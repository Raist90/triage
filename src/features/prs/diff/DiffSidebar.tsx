import { EyeOff, Search, X } from "lucide-react";
import { useRef } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { cx } from "../../../lib/cx";
import type {
  DiffFile,
  DiffFileKind,
  Walkthrough,
  WalkthroughStep,
} from "../../../lib/types";
import type { DiffSort } from "../../../stores/ui";
import {
  DIFF_FILE_KINDS,
  FILE_KIND_LABEL,
  FILE_STATUS_MARK,
  focusBand,
  isCosmeticFile,
  reviewSignals,
  splitPath,
} from "./diffFile";

type FileEntry = {
  key: string;
  file: DiffFile;
};

export function DiffSidebar({
  files,
  activeKey,
  filter,
  filterInputRef,
  kindCounts,
  hiddenKinds,
  totalCount,
  hiddenCount,
  hasReview,
  sort,
  pathMode,
  walkthrough,
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
  files: FileEntry[];
  activeKey: string | null;
  filter: string;
  filterInputRef: RefObject<HTMLInputElement | null>;
  kindCounts: Record<DiffFileKind, number>;
  hiddenKinds: DiffFileKind[];
  /** Every file in the diff, before kinds, cosmetic, priority and search. */
  totalCount: number;
  /** Files the rail is not showing, for any reason. */
  hiddenCount: number;
  /** True when the backend scored the files and ranking is meaningful. */
  hasReview: boolean;
  sort: DiffSort;
  /** Resolved by the parent; never re-derived here from the walkthrough. */
  pathMode: boolean;
  walkthrough?: Walkthrough;
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
  const steps = pathMode ? walkthrough?.steps : undefined;
  const hasSteps = steps !== undefined;
  const highCount = files.filter(
    ({ file }) => focusBand(file) === "high",
  ).length;
  const firstKey = files[0]?.key;

  return (
    <aside
      aria-label={pathMode ? "Review path" : "Files in this pull request"}
      className="flex shrink-0 flex-col border-r border-line"
      style={{ width: "var(--diff-rail, 208px)" }}
    >
      {pathMode ? null : (
        <SidebarFilters
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
          onSelectFirst={firstKey ? () => onSelect(firstKey) : undefined}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {hasSteps ? (
          steps.map((step, index) => (
            <StepRow
              key={step.id}
              index={index}
              active={step.id === activeStepID}
              onSelect={() => onSelectStep(step.id)}
              step={step}
            />
          ))
        ) : files.length === 0 ? (
          <p className="p-2 text-meta text-fg-faint">No files match.</p>
        ) : (
          files.map(({ key, file }) => (
            <FileRow
              key={key}
              file={file}
              active={key === activeKey}
              onSelect={() => onSelect(key)}
            />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2 font-mono text-micro text-fg-faint tabular-nums">
        {hasSteps
          ? `${steps.length} ${steps.length === 1 ? "step" : "steps"} · every change covered`
          : filesSummary(files.length, totalCount, hiddenCount, highCount)}
      </div>
    </aside>
  );
}

function filesSummary(
  visibleCount: number,
  totalCount: number,
  hiddenCount: number,
  highCount: number,
): string {
  const counts =
    hiddenCount === 0
      ? `${totalCount} ${totalCount === 1 ? "file" : "files"}`
      : `${visibleCount} of ${totalCount} files · ${hiddenCount} hidden`;
  return highCount > 0 ? `${counts} · ${highCount} high` : counts;
}

function SidebarFilters({
  filter,
  filterInputRef,
  kindCounts,
  hiddenKinds,
  hasReview,
  sort,
  hideLowPriority,
  lowCount,
  onFilterChange,
  onToggleKind,
  onSortChange,
  onToggleLowPriority,
  onSelectFirst,
}: {
  filter: string;
  filterInputRef: RefObject<HTMLInputElement | null>;
  kindCounts: Record<DiffFileKind, number>;
  hiddenKinds: DiffFileKind[];
  hasReview: boolean;
  sort: DiffSort;
  hideLowPriority: boolean;
  lowCount: number;
  onFilterChange: (value: string) => void;
  onToggleKind: (kind: DiffFileKind) => void;
  onSortChange: (sort: DiffSort) => void;
  onToggleLowPriority: () => void;
  /** Enter in the search box opens the first match. */
  onSelectFirst?: () => void;
}) {
  const kinds = DIFF_FILE_KINDS.filter((kind) => kindCounts[kind] > 0);

  return (
    <div className="shrink-0 border-b border-line p-2">
      <label className="relative block">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-faint"
          aria-hidden
        />
        <input
          ref={filterInputRef}
          type="text"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onSelectFirst) {
              event.preventDefault();
              onSelectFirst();
              event.currentTarget.blur();
              return;
            }
            if (event.key !== "Escape" || !filter) return;
            // Clear first; with no text the key falls through to close the PR.
            event.stopPropagation();
            onFilterChange("");
          }}
          placeholder="Filter files"
          aria-label="Filter files"
          className="h-7 w-full rounded-sm border border-line bg-surface px-8 text-meta text-fg placeholder:text-fg-faint focus:border-line-strong focus:outline-none"
        />
        {filter ? (
          <button
            type="button"
            onClick={() => onFilterChange("")}
            aria-label="Clear file filter"
            className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-fg-faint transition-colors hover:text-fg"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </label>

      {kinds.length > 0 ? (
        <div
          role="group"
          aria-label="Hide file types"
          className="mt-2 flex flex-wrap gap-1"
        >
          {kinds.map((kind) => (
            <ToggleChip
              key={kind}
              kind={kind}
              count={kindCounts[kind]}
              excluded={hiddenKinds.includes(kind)}
              onToggle={() => onToggleKind(kind)}
            />
          ))}
        </div>
      ) : null}

      {hasReview ? (
        <>
          <SortControl sort={sort} onSortChange={onSortChange} />
          {lowCount > 0 ? (
            <LowFocusToggle
              lowCount={lowCount}
              hidden={hideLowPriority}
              onToggle={onToggleLowPriority}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const CHIP_BASE =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-2 text-meta font-medium transition-colors";
const CHIP_ACTIVE = "border-line-strong bg-surface text-fg";
const CHIP_IDLE =
  "border-line text-fg-faint hover:border-line-strong hover:text-fg";

/** One pressed-state outline chip; the sort, kind and low-focus filters share it. */
function Chip({
  active,
  buttonRef,
  className,
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "ref"> & {
  active: boolean;
  buttonRef?: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type={type}
      className={cx(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE, className)}
      {...props}
    />
  );
}

const SORT_ORDER: DiffSort[] = ["priority", "path"];

const SORT_LABEL: Record<DiffSort, string> = {
  priority: "Priority",
  path: "Path",
};

/** Mutually exclusive sort choice: a radio group, not two independent toggles. */
function SortControl({
  sort,
  onSortChange,
}: {
  sort: DiffSort;
  onSortChange: (sort: DiffSort) => void;
}) {
  const radios = useRef<Partial<Record<DiffSort, HTMLButtonElement | null>>>(
    {},
  );

  return (
    <div
      role="radiogroup"
      aria-label="Sort diff files"
      className="mt-2 flex items-center gap-1"
      onKeyDown={(event) => {
        const delta =
          event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? -1
              : 0;
        if (delta === 0) return;
        event.preventDefault();
        const next =
          SORT_ORDER[
            (SORT_ORDER.indexOf(sort) + delta + SORT_ORDER.length) %
              SORT_ORDER.length
          ];
        onSortChange(next);
        radios.current[next]?.focus();
      }}
    >
      {SORT_ORDER.map((option) => {
        const active = sort === option;
        return (
          <Chip
            key={option}
            buttonRef={(element) => {
              radios.current[option] = element;
            }}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            active={active}
            onClick={() => onSortChange(option)}
          >
            {SORT_LABEL[option]}
          </Chip>
        );
      })}
    </div>
  );
}

function LowFocusToggle({
  lowCount,
  hidden,
  onToggle,
}: {
  lowCount: number;
  hidden: boolean;
  onToggle: () => void;
}) {
  const filesLabel = lowCount === 1 ? "file" : "files";

  return (
    <Chip
      active={hidden}
      aria-pressed={hidden}
      aria-label={`Low focus, ${lowCount} ${filesLabel}, ${hidden ? "hidden" : "shown"}`}
      title={`${hidden ? "Show" : "Hide"} ${lowCount} low-focus ${filesLabel}`}
      className="mt-2 w-full justify-center"
      onClick={onToggle}
    >
      <span className={hidden ? "text-fg" : "text-fg-muted"}>Low focus</span>
      <span className="font-mono text-micro text-fg-faint tabular-nums">
        {lowCount}
      </span>
    </Chip>
  );
}

const FOCUS_DOT: Record<"high" | "medium" | "low", string> = {
  high: "border-fg bg-fg",
  medium: "border-fg-muted bg-fg-muted",
  low: "border-fg-faint bg-transparent",
};

function FileRow({
  active,
  file,
  onSelect,
}: {
  active: boolean;
  file: DiffFile;
  onSelect: () => void;
}) {
  const status = FILE_STATUS_MARK[file.status];
  const { dir, name } = splitPath(file.path);
  const band = focusBand(file);
  const signals = reviewSignals(file);
  const focusTitle = file.review
    ? `${band} focus ${file.review.score}/100${signals.length > 0 ? ` · ${signals.join(" · ")}` : ""}`
    : "";
  const title = `${file.oldPath ? `${file.path} (from ${file.oldPath})` : file.path}${focusTitle ? ` · ${focusTitle}` : ""}`;

  return (
    <SidebarRow
      active={active}
      current="location"
      onSelect={onSelect}
      title={title}
      className="flex h-9 items-center gap-2 px-2"
    >
      <span
        className={`w-3.5 shrink-0 rounded-sm border text-center font-mono text-micro leading-none ${status.className}`}
        title={file.status}
      >
        {status.mark}
      </span>
      <span className="min-w-0 flex-1 leading-4">
        <span
          className={`block truncate font-mono text-meta ${
            active
              ? "text-fg"
              : band === "low"
                ? "text-fg-faint"
                : "text-fg-body"
          }`}
        >
          {name}
        </span>
        <span className="block truncate font-mono text-micro text-fg-faint">
          {dir || file.path}
        </span>
      </span>
      {file.review ? (
        <span
          aria-label={`${band} focus`}
          title={focusTitle}
          className={`size-1.5 shrink-0 rounded-full border ${FOCUS_DOT[band]}`}
        />
      ) : null}
      <span className="shrink-0 self-start pt-1 font-mono text-micro text-fg-faint tabular-nums">
        <span className="text-accent/80">+{file.additions}</span>
        <span className="px-1 text-line-strong">/</span>
        <span>−{file.deletions}</span>
      </span>
      {isCosmeticFile(file) ? (
        <span
          aria-label="Cosmetic only"
          title="Cosmetic only"
          className="size-1 shrink-0 rounded-full bg-fg-faint"
        />
      ) : null}
    </SidebarRow>
  );
}

/** One synthetic commit: subject, scope and size, with the path's order. */
function StepRow({
  index,
  active,
  onSelect,
  step,
}: {
  index: number;
  active: boolean;
  onSelect: () => void;
  step: WalkthroughStep;
}) {
  return (
    <SidebarRow
      active={active}
      current="step"
      onSelect={onSelect}
      title={`${step.title} · ${step.files.length} files`}
      className="flex flex-col gap-0.5 p-2"
    >
      <span className="flex w-full min-w-0 items-baseline gap-2">
        <span className="w-3 shrink-0 font-mono text-micro text-fg-faint tabular-nums">
          {index + 1}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-meta ${
            active ? "text-fg" : "text-fg-body"
          }`}
        >
          {step.title}
        </span>
      </span>
      <span className="flex items-center gap-2 pl-5 font-mono text-micro text-fg-faint tabular-nums">
        <span>
          {step.files.length} {step.files.length === 1 ? "file" : "files"}
        </span>
        <span className="text-accent/80">+{step.additions}</span>
        <span className="px-1 text-line-strong">/</span>
        <span>−{step.deletions}</span>
      </span>
    </SidebarRow>
  );
}

/** Selectable row in the diff rail: hover fill plus the active accent rail. */
function SidebarRow({
  active,
  current,
  children,
  className,
  onSelect,
  title,
}: {
  active: boolean;
  /** What the active row represents to assistive tech, such as "step". */
  current: "location" | "step";
  children: ReactNode;
  className: string;
  onSelect: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? current : undefined}
      title={title}
      className={cx(
        "relative w-full text-left transition-colors",
        active
          ? "bg-surface before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
          : "hover:bg-surface/60",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ToggleChip({
  kind,
  count,
  excluded,
  onToggle,
}: {
  kind: DiffFileKind;
  count: number;
  excluded: boolean;
  onToggle: () => void;
}) {
  const label = FILE_KIND_LABEL[kind];
  const filesLabel = count === 1 ? "file" : "files";

  return (
    <Chip
      active={excluded}
      aria-pressed={excluded}
      aria-label={`${label}, ${count} ${filesLabel}, ${excluded ? "hidden" : "shown"}`}
      title={`${excluded ? "Show" : "Hide"} ${count} ${label.toLowerCase()} ${filesLabel}`}
      onClick={onToggle}
    >
      {excluded ? (
        <EyeOff className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
      ) : null}
      <span className={excluded ? "text-fg" : "text-fg-muted"}>{label}</span>
      <span className="font-mono text-micro text-fg-faint tabular-nums">
        {count}
      </span>
    </Chip>
  );
}
