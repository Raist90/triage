import type { DiffFile } from "../../../../lib/types";
import {
  FILE_STATUS_MARK,
  focusBand,
  isCosmeticFile,
  reviewSignals,
  splitPath,
} from "../diffFile";
import { rowClass } from "./rowClass";

const FOCUS_DOT: Record<"high" | "medium" | "low", string> = {
  high: "border-fg bg-fg",
  medium: "border-fg-muted bg-fg-muted",
  low: "border-fg-faint bg-transparent",
};

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
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      title={title}
      className={`${rowClass(active)} flex h-9 items-center gap-2 px-2`}
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
    </button>
  );
}
