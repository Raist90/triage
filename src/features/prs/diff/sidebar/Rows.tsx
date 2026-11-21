import type { ReactNode } from "react";
import type { DiffFile, WalkthroughStep } from "../../../../lib/types";
import { cx } from "../../../../lib/cx";
import {
  FILE_STATUS_MARK,
  focusBand,
  isCosmeticFile,
  reviewSignals,
  splitPath,
} from "../diffFile";

const FOCUS_DOT: Record<"high" | "medium" | "low", string> = {
  high: "border-fg bg-fg",
  medium: "border-fg-muted bg-fg-muted",
  low: "border-fg-faint bg-transparent",
};

/** Selectable row in the diff rail: hover fill plus the active accent rail. */
function RowButton({
  active,
  children,
  className,
  onSelect,
  title,
}: {
  active: boolean;
  children: ReactNode;
  className: string;
  onSelect: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
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

export function FileRow({
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
    <RowButton
      active={active}
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
    </RowButton>
  );
}

/** One synthetic commit: subject, scope and size, with the path's order. */
export function StepRow({
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
    <RowButton
      active={active}
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
        <span className="text-danger/80">−{step.deletions}</span>
      </span>
    </RowButton>
  );
}
