import { ChevronRight, CornerDownRight } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button, MicroLabel } from "../../components/ui";
import { cx } from "../../lib/cx";
import { revealPath } from "../../lib/open";
import { formatAgo } from "../../lib/time";
import type { DiffFile, ReviewFinding, ReviewSeverity } from "../../lib/types";
import { FindingHunk } from "./FindingHunk";
import { findHunk, sliceHunk } from "./reviewHunks";

/** Color roles only: blocking and praise carry meaning, the rest stay neutral. */
const SEVERITY_TEXT: Record<ReviewSeverity, string> = {
  blocking: "text-danger!",
  warning: "text-fg!",
  nitpick: "text-fg-faint!",
  praise: "text-accent!",
};

type FindingCardProps = {
  finding: ReviewFinding;
  /** The PR diff already loaded by PRDetail; used for the hunk snippet. */
  diffFiles?: DiffFile[];
  /** C6: jump to the finding's hunk in the diff tab. */
  onOpenInDiff?: (finding: ReviewFinding) => void;
  /** C7: apply the finding's patch to the worktree. */
  onApply?: (finding: ReviewFinding) => void;
  /** C7: an apply request for this finding is in flight. */
  applying?: boolean;
  /** C7: the readable failure for this finding's last apply. */
  applyError?: string;
  /** C7: the worktree path, shown after a patch is applied. */
  worktree?: string;
};

function anchorLabel(finding: ReviewFinding): string {
  const start = `${finding.file}:${finding.line}`;
  if (finding.endLine && finding.endLine !== finding.line) {
    return `${start}-${finding.endLine}`;
  }
  return start;
}

/**
 * One finding. Collapsed to a single row by default; blocking cards start open.
 * The toggle is a real button, actions live in the expanded body so nothing is
 * nested inside it.
 */
export function FindingCard({
  finding,
  diffFiles,
  onOpenInDiff,
  onApply,
  applying = false,
  applyError,
  worktree,
}: FindingCardProps) {
  const bodyId = useId();
  // Local only. A blocking card the user closed stays closed across renders.
  const [open, setOpen] = useState(finding.severity === "blocking");
  const [preview, setPreview] = useState(false);

  const hunk = useMemo(() => {
    if (!diffFiles) return null;
    const match = findHunk(diffFiles, finding.file, finding.line);
    if (!match) return null;
    return { match, lines: sliceHunk(match.hunk, finding.line, 12) };
  }, [diffFiles, finding.file, finding.line]);

  return (
    <article className="rounded-[4px] border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full flex-col gap-1 rounded-[4px] px-3 py-3 text-left transition-colors hover:bg-surface"
      >
        <span className="flex w-full min-w-0 items-baseline gap-3">
          <MicroLabel
            className={cx("shrink-0", SEVERITY_TEXT[finding.severity])}
          >
            {finding.severity}
          </MicroLabel>
          <span className="shrink-0 font-mono text-meta text-fg-faint">
            {finding.category}
          </span>
          <span className="ml-auto flex min-w-0 items-baseline gap-2">
            <span className="tabular min-w-0 truncate font-mono text-meta text-fg-faint">
              {anchorLabel(finding)}
            </span>
            {finding.anchored ? null : (
              <span className="shrink-0 text-micro text-fg-faint">
                no exact line
              </span>
            )}
            {finding.appliedAt ? (
              <span className="shrink-0 text-meta text-accent">
                Applied {formatAgo(finding.appliedAt)}
              </span>
            ) : null}
            <ChevronRight
              aria-hidden
              className={cx(
                "size-3.5 shrink-0 text-fg-faint transition-transform",
                open && "rotate-90",
              )}
            />
          </span>
        </span>
        <span className="text-ui font-medium text-fg">{finding.title}</span>
      </button>

      <div
        id={bodyId}
        hidden={!open}
        className="border-t border-line px-3 py-3"
      >
        <p className="max-w-[72ch] text-prose text-fg-body">{finding.claim}</p>

        {hunk ? <FindingHunk match={hunk.match} lines={hunk.lines} /> : null}

        {finding.suggestion ? (
          <div className="mt-3">
            <MicroLabel>Suggestion</MicroLabel>
            <p className="mt-1 max-w-[72ch] text-prose text-fg-body">
              {finding.suggestion}
            </p>
          </div>
        ) : null}

        {/* C7 adds Preview patch and Apply to this row. */}
        {onOpenInDiff || finding.patch || finding.appliedAt ? (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {finding.appliedAt ? (
                <span className="text-meta text-accent">
                  Applied {formatAgo(finding.appliedAt)} · not pushed
                </span>
              ) : finding.patch ? (
                <>
                  <Button
                    variant="outline"
                    aria-expanded={preview}
                    onClick={() => setPreview((current) => !current)}
                  >
                    {preview ? "Hide patch" : "Preview patch"}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => onApply?.(finding)}
                    disabled={applying || !onApply}
                  >
                    {applying ? "Applying…" : "Apply"}
                  </Button>
                </>
              ) : null}
              {onOpenInDiff ? (
                <Button variant="ghost" onClick={() => onOpenInDiff(finding)}>
                  <CornerDownRight className="size-3.5" aria-hidden />
                  Open in diff
                </Button>
              ) : null}
              {finding.appliedAt && worktree ? (
                <Button
                  variant="ghost"
                  onClick={() => void revealPath(worktree)}
                >
                  Reveal
                </Button>
              ) : null}
            </div>

            {preview && finding.patch && !finding.appliedAt ? (
              <PatchPreview patch={finding.patch} />
            ) : null}

            {applyError ? (
              <p className="text-meta text-danger">{applyError}</p>
            ) : null}

            {finding.appliedAt ? (
              <p className="font-mono text-micro break-all text-fg-faint select-all">
                {worktree ?? "worktree path unavailable"}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

const PATCH_LINE_CLASS = {
  header: "text-fg-faint",
  add: "text-accent",
  del: "text-danger",
  hunk: "text-fg-faint",
  context: "text-fg-body",
} as const;

function patchLineKind(line: string): keyof typeof PATCH_LINE_CLASS {
  if (line.startsWith("+++") || line.startsWith("---")) return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/** The raw patch, read-only. Colour by prefix, no syntax highlighting. */
function PatchPreview({ patch }: { patch: string }) {
  return (
    <div className="max-h-60 overflow-auto rounded-[4px] border border-line bg-canvas px-3 py-2">
      {patch.split("\n").map((line, index) => (
        <div
          key={index}
          className={cx(
            "font-mono text-code whitespace-pre",
            PATCH_LINE_CLASS[patchLineKind(line)],
          )}
        >
          {line === "" ? " " : line}
        </div>
      ))}
    </div>
  );
}
