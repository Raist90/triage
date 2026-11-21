import { EyeOff, Search, X } from "lucide-react";
import { useRef } from "react";
import type { ComponentProps, RefObject } from "react";
import { cx } from "../../../lib/cx";
import type { DiffFileKind } from "../../../lib/types";
import type { DiffSort } from "../../../stores/ui";
import { DIFF_FILE_KINDS, FILE_KIND_LABEL } from "./diffFile";

/** Rail chrome: path search, file-type toggles and the review-driven order. */
export function DiffSidebarFilters({
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
  onSelectFirst: () => void;
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
            if (event.key === "Enter") {
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
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  active: boolean;
}) {
  return (
    <button
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
            ref={(element) => {
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
