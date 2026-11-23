import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { cx } from "../../../lib/cx";
import type { DiffFile, WalkthroughStep } from "../../../lib/types";
import {
  FILE_STATUS_MARK,
  focusBand,
  isCosmeticFile,
  reviewSignals,
  splitPath,
} from "./diffFile";
import type { DiffFileEntry } from "./diffSelection";

/**
 * Rows the rail shows: the path's steps in path mode, the search-matched file
 * list otherwise, or one notice when the search matches nothing.
 *
 * `activeKey`, or `activeStepID` in path mode, names the selected row. The
 * active row is kept inside the scroller, so `j`/`k` past the visible rows
 * never moves a highlight the user cannot see.
 */
export function DiffRailList({
  files,
  steps,
  activeKey,
  activeStepID,
  onSelectStep,
  onSelect,
  onScrollerRef,
  edgeClassName,
}: {
  files: DiffFileEntry[];
  /** The resolved path steps; undefined renders the file list. */
  steps?: WalkthroughStep[];
  activeKey: string | null;
  activeStepID?: string;
  onSelectStep: (stepID: string) => void;
  onSelect: (key: string) => void;
  /** The scrolling element, so the owner can attach scroll-edge fades. */
  onScrollerRef?: (node: HTMLDivElement | null) => void;
  /** Clipped-edge fade classes from the owner's `useScrollEdges`. */
  edgeClassName?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeID = steps ? (activeStepID ?? null) : activeKey;

  // `nearest` leaves a row that is already fully visible alone, so a click
  // never shifts the list; a row past an edge is brought in just far enough.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || activeID === null) return;
    const row = Array.from(
      scroller.querySelectorAll<HTMLElement>("[data-rail-key]"),
    ).find((candidate) => candidate.dataset.railKey === activeID);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeID]);

  let rows: ReactNode;
  if (steps) {
    rows = steps.map((step, index) => (
      <StepRow
        key={step.id}
        index={index}
        active={step.id === activeStepID}
        onSelect={() => onSelectStep(step.id)}
        step={step}
      />
    ));
  } else if (files.length === 0) {
    rows = <p className="p-2 text-meta text-fg-faint">No files match.</p>;
  } else {
    rows = files.map(({ key, file }) => (
      <FileRow
        key={key}
        fileKey={key}
        file={file}
        active={key === activeKey}
        onSelect={() => onSelect(key)}
      />
    ));
  }

  // `isolate` gives the scroller its own stacking context. Without it WebKit
  // paints the rows' positioned fills above the overlay scrollbar.
  return (
    <div
      ref={(node) => {
        scrollerRef.current = node;
        onScrollerRef?.(node);
      }}
      className={cx(
        "isolate min-h-0 flex-1 overflow-y-auto py-1",
        edgeClassName,
      )}
    >
      {rows}
    </div>
  );
}

const FOCUS_DOT: Record<"high" | "medium" | "low", string> = {
  high: "border-fg bg-fg",
  medium: "border-fg-muted bg-fg-muted",
  low: "border-fg-faint bg-transparent",
};

function FileRow({
  active,
  fileKey,
  file,
  onSelect,
}: {
  active: boolean;
  /** The rail key, exposed so the scroller can find the active row. */
  fileKey: string;
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
      dataKey={fileKey}
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
      <ChangeStat
        additions={file.additions}
        deletions={file.deletions}
        className="shrink-0 self-start pt-1"
      />
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
      dataKey={step.id}
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
        <ChangeStat
          additions={step.additions}
          deletions={step.deletions}
          className="flex items-center gap-2"
        />
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
  dataKey,
  onSelect,
  title,
}: {
  active: boolean;
  /** What the active row represents to assistive tech, such as "step". */
  current: "location" | "step";
  children: ReactNode;
  className: string;
  /** Stable row identity, matched by the scroller's active-row lookup. */
  dataKey: string;
  onSelect: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? current : undefined}
      data-rail-key={dataKey}
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

/** The `+n / −n` pair the file row and the step row share. */
function ChangeStat({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "font-mono text-micro text-fg-faint tabular-nums",
        className,
      )}
    >
      <span className="text-accent">+{additions}</span>
      <span className="px-1 text-line-strong">/</span>
      <span>−{deletions}</span>
    </span>
  );
}
