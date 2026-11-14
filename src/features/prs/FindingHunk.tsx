import { cx } from "../../lib/cx";
import type { DiffLine } from "../../lib/types";
import type { HunkMatch } from "./reviewHunks";

const SIGN: Record<DiffLine["kind"], string> = {
  context: " ",
  add: "+",
  del: "-",
};

const SIGN_CLASS: Record<DiffLine["kind"], string> = {
  context: "text-fg-faint",
  add: "text-accent",
  del: "text-danger",
};

const TEXT_CLASS: Record<DiffLine["kind"], string> = {
  context: "text-fg-muted",
  add: "text-fg-body",
  del: "text-fg-body",
};

type FindingHunkProps = {
  match: HunkMatch;
  lines: DiffLine[];
};

/**
 * The changed lines a finding points at. Read-only, capped by the caller, no
 * syntax highlighting: the snippet is evidence, not decoration.
 */
export function FindingHunk({ match, lines }: FindingHunkProps) {
  return (
    <div className="mt-3 rounded-[4px] border border-line bg-canvas">
      <div className="flex h-6 items-center gap-2 border-b border-line px-3">
        <span className="min-w-0 truncate font-mono text-micro text-fg-faint">
          {match.file.path}
        </span>
        <span className="ml-auto min-w-0 truncate font-mono text-micro text-fg-faint">
          {match.hunk.header}
        </span>
      </div>
      <div className="overflow-x-auto py-1">
        {lines.map((line, index) => (
          <div
            key={`${index}:${line.oldNumber ?? ""}:${line.newNumber ?? ""}`}
            className="flex gap-2 px-3 text-code"
          >
            <span className="tabular w-8 shrink-0 text-right font-mono text-fg-faint select-none">
              {line.oldNumber ?? ""}
            </span>
            <span className="tabular w-8 shrink-0 text-right font-mono text-fg-faint select-none">
              {line.newNumber ?? ""}
            </span>
            <span
              aria-hidden="true"
              className={cx(
                "w-3 shrink-0 font-mono select-none",
                SIGN_CLASS[line.kind],
              )}
            >
              {SIGN[line.kind]}
            </span>
            <span
              className={cx(
                "tabular font-mono whitespace-pre",
                TEXT_CLASS[line.kind],
              )}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
