import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { Button, MicroLabel } from "../../components/ui";
import { cx } from "../../lib/cx";
import { formatAgo } from "../../lib/time";
import type { ReviewFinding, ReviewSeverity } from "../../lib/types";

/** Color roles only: blocking and praise carry meaning, the rest stay neutral. */
const SEVERITY_TEXT: Record<ReviewSeverity, string> = {
  blocking: "text-danger!",
  warning: "text-fg!",
  nitpick: "text-fg-faint!",
  praise: "text-accent!",
};

type FindingCardProps = {
  finding: ReviewFinding;
  /** C6: jump to the finding's hunk in the diff tab. */
  onOpenInDiff?: (finding: ReviewFinding) => void;
  /** C7: apply the finding's patch to the worktree. */
  onApply?: (finding: ReviewFinding) => void;
  /** C7: an apply request for this finding is in flight. */
  applying?: boolean;
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
export function FindingCard({ finding, onOpenInDiff }: FindingCardProps) {
  const bodyId = useId();
  // Local only. A blocking card the user closed stays closed across renders.
  const [open, setOpen] = useState(finding.severity === "blocking");

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

        {finding.suggestion ? (
          <div className="mt-3">
            <MicroLabel>Suggestion</MicroLabel>
            <p className="mt-1 max-w-[72ch] text-prose text-fg-body">
              {finding.suggestion}
            </p>
          </div>
        ) : null}

        {/* C6 renders the hunk snippet here, between claim and actions. */}

        {/* C7 adds Preview patch and Apply to this row. */}
        {onOpenInDiff ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => onOpenInDiff(finding)}>
              Open in diff
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
