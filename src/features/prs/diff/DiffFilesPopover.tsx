import { EyeOff, ListTree, Search, X } from "lucide-react";
import type { ComponentProps, RefObject } from "react";
import { cx } from "../../../lib/cx";
import type { DiffFile, WalkthroughStep } from "../../../lib/types";
import { useUIStore } from "../../../stores/ui";
import {
  DIFF_FILE_KINDS,
  FILE_KIND_LABEL,
  FILE_STATUS_MARK,
  isCosmeticFile,
  splitPath,
} from "./diffFile";
import type { DiffFileEntry, DiffSelection } from "./diffSelection";

type DiffFilesPopoverProps = {
  files: DiffFile[];
  /** Files after the kind, cosmetic and priority filters plus the search. */
  matched: DiffFileEntry[];
  selection: DiffSelection;
  filter: string;
  filterInputRef: RefObject<HTMLInputElement | null>;
  activeKey: string | null;
  focusMode: boolean;
  hasSemantic: boolean;
  showSemanticRail: boolean;
  hasPath: boolean;
  pathMode: boolean;
  steps: WalkthroughStep[];
  activeStepID?: string;
  onFilterChange: (value: string) => void;
  onSelectFile: (key: string) => void;
  onSelectStep: (id: string) => void;
  onToggleFocusMode: () => void;
  onTogglePathMode: () => void;
  onToggleSemanticRail: () => void;
  onClearFileKinds: () => void;
  onClose: () => void;
};

/**
 * The diff's only secondary surface: search, file-kind and focus filters, the
 * review order, walkthrough steps and the file list. It replaces the old rail
 * without dropping any of its controls.
 */
export function DiffFilesPopover({
  files,
  matched,
  selection,
  filter,
  filterInputRef,
  activeKey,
  focusMode,
  hasSemantic,
  showSemanticRail,
  hasPath,
  pathMode,
  steps,
  activeStepID,
  onFilterChange,
  onSelectFile,
  onSelectStep,
  onToggleFocusMode,
  onTogglePathMode,
  onToggleSemanticRail,
  onClearFileKinds,
  onClose,
}: DiffFilesPopoverProps) {
  const hiddenKinds = useUIStore((state) => state.hiddenFileKinds);
  const toggleFileKind = useUIStore((state) => state.toggleFileKind);
  const sort = useUIStore((state) => state.diffSort);
  const setSort = useUIStore((state) => state.setDiffSort);
  const hideLowPriority = useUIStore((state) => state.hideLowPriority);
  const toggleLowPriority = useUIStore((state) => state.toggleLowPriority);
  const kinds = DIFF_FILE_KINDS.filter(
    (kind) => selection.kindCounts[kind] > 0,
  );

  const first = matched[0];
  return (
    <div
      role="dialog"
      aria-label="Diff files"
      className="absolute top-full right-0 z-30 mt-1 flex max-h-[70vh] w-80 surface-in flex-col rounded-md border border-line-strong elevated"
    >
      <div className="flex items-center gap-2 border-b border-line p-2">
        <Search className="size-3.5 shrink-0 text-fg-faint" aria-hidden />
        <input
          ref={filterInputRef}
          type="text"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (first) onSelectFile(first.key);
              onClose();
              return;
            }
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (filter) {
              onFilterChange("");
              return;
            }
            onClose();
          }}
          placeholder="Filter files"
          aria-label="Filter files"
          autoFocus
          className="h-7 min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 text-meta text-fg placeholder:text-fg-faint focus:border-line-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close files"
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-faint transition-colors hover:bg-surface hover:text-fg"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="shrink-0 border-b border-line p-2">
        {kinds.length > 0 ? (
          <div
            role="group"
            aria-label="Hide file types"
            className="flex flex-wrap gap-1"
          >
            {kinds.map((kind) => (
              <Chip
                key={kind}
                active={hiddenKinds.includes(kind)}
                aria-pressed={hiddenKinds.includes(kind)}
                aria-label={`${FILE_KIND_LABEL[kind]}, ${selection.kindCounts[kind]} ${selection.kindCounts[kind] === 1 ? "file" : "files"}, ${hiddenKinds.includes(kind) ? "hidden" : "shown"}`}
                onClick={() => toggleFileKind(kind)}
              >
                {hiddenKinds.includes(kind) ? (
                  <EyeOff className="size-3.5 shrink-0" aria-hidden />
                ) : null}
                {FILE_KIND_LABEL[kind]}
                <span className="font-mono text-micro text-fg-faint tabular-nums">
                  {selection.kindCounts[kind]}
                </span>
              </Chip>
            ))}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Chip
            active={focusMode}
            aria-pressed={focusMode}
            onClick={onToggleFocusMode}
          >
            One at a time
          </Chip>
          {hasPath ? (
            <Chip
              active={pathMode}
              aria-pressed={pathMode}
              onClick={onTogglePathMode}
            >
              <ListTree className="size-3.5" aria-hidden />
              Steps
            </Chip>
          ) : null}
          {hasSemantic ? (
            <Chip
              active={showSemanticRail}
              aria-pressed={showSemanticRail}
              onClick={onToggleSemanticRail}
            >
              Map
            </Chip>
          ) : null}
          {selection.cosmeticFiles > 0 ? (
            <span className="ml-auto font-mono text-micro text-fg-faint tabular-nums">
              {selection.cosmeticFiles} cosmetic
            </span>
          ) : null}
        </div>

        {selection.hasReview ? (
          <div className="mt-2 flex items-center gap-1">
            <div
              role="radiogroup"
              aria-label="Sort diff files"
              className="flex items-center gap-1"
              onKeyDown={(event) => {
                const delta =
                  event.key === "ArrowRight" || event.key === "ArrowDown"
                    ? 1
                    : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? -1
                      : 0;
                if (delta === 0) return;
                event.preventDefault();
                setSort(sort === "priority" ? "path" : "priority");
              }}
            >
              <SortRadio
                label="Priority"
                active={sort === "priority"}
                onClick={() => setSort("priority")}
              />
              <SortRadio
                label="Path"
                active={sort === "path"}
                onClick={() => setSort("path")}
              />
            </div>
            {selection.lowCount > 0 ? (
              <Chip
                active={hideLowPriority}
                aria-pressed={hideLowPriority}
                onClick={toggleLowPriority}
                className="ml-auto"
              >
                Low focus
                <span className="font-mono text-micro text-fg-faint tabular-nums">
                  {selection.lowCount}
                </span>
              </Chip>
            ) : null}
          </div>
        ) : null}

        {selection.hiddenByKind > 0 ? (
          <p className="mt-2 flex items-center gap-2 font-mono text-micro text-fg-faint">
            {selection.hiddenByKind} hidden
            <button
              type="button"
              onClick={onClearFileKinds}
              className="text-fg-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-fg"
            >
              Clear
            </button>
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {pathMode ? (
          steps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                onSelectStep(step.id);
                onClose();
              }}
              aria-current={step.id === activeStepID ? "step" : undefined}
              className={cx(
                "flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-meta transition-colors",
                step.id === activeStepID
                  ? "bg-surface text-fg"
                  : "text-fg-body hover:bg-surface/60",
              )}
            >
              <span className="w-3 shrink-0 font-mono text-micro text-fg-faint tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{step.title}</span>
              <span className="shrink-0 font-mono text-micro text-fg-faint tabular-nums">
                {step.files.length}
              </span>
            </button>
          ))
        ) : matched.length === 0 ? (
          <p className="p-2 text-meta text-fg-faint">No files match.</p>
        ) : (
          matched.map(({ key, file }) => {
            const status = FILE_STATUS_MARK[file.status];
            const { dir, name } = splitPath(file.path);
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onSelectFile(key);
                  onClose();
                }}
                aria-current={key === activeKey ? "location" : undefined}
                data-rail-key={key}
                className={cx(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
                  key === activeKey ? "bg-surface" : "hover:bg-surface/60",
                )}
              >
                <span
                  className={cx(
                    "w-3.5 shrink-0 rounded-sm border text-center font-mono text-micro leading-none",
                    status.className,
                  )}
                >
                  {status.mark}
                </span>
                <span className="min-w-0 flex-1 leading-4">
                  <span
                    className={cx(
                      "block truncate font-mono text-meta",
                      key === activeKey ? "text-fg" : "text-fg-body",
                    )}
                  >
                    {name}
                  </span>
                  <span className="block truncate font-mono text-micro text-fg-faint">
                    {dir || file.path}
                  </span>
                </span>
                {isCosmeticFile(file) ? (
                  <span className="size-1 shrink-0 rounded-full bg-fg-faint" />
                ) : null}
                <span className="shrink-0 font-mono text-micro text-fg-faint tabular-nums">
                  <span className="text-accent">+{file.additions}</span>
                  <span className="px-0.5 text-line-strong">/</span>
                  <span>−{file.deletions}</span>
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-line px-2 py-1.5 font-mono text-micro text-fg-faint tabular-nums">
        {matched.length} of {files.length} files
      </div>
    </div>
  );
}

const CHIP_BASE =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-2 text-meta transition-colors";
const CHIP_ACTIVE = "border-line-strong bg-surface text-fg";
const CHIP_IDLE =
  "border-line text-fg-faint hover:border-line-strong hover:text-fg";

function Chip({
  active,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type={type}
      className={cx(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE, className)}
      {...props}
    />
  );
}

function SortRadio({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Chip
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      active={active}
      onClick={onClick}
    >
      {label}
    </Chip>
  );
}
