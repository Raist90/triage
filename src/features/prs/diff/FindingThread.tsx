import { Sparkles } from "lucide-react";
import { cx } from "../../../lib/cx";
import { formatAgo } from "../../../lib/time";
import type { ReviewFinding, ReviewSeverity } from "../../../lib/types";
import { useReviewFindings } from "./ReviewFindingsContext";

const SEVERITY_TAG: Record<ReviewSeverity, string> = {
  blocking: "border-danger/32 text-danger",
  warning: "border-line text-fg-muted",
  nitpick: "border-line text-fg-faint",
  praise: "border-accent/28 text-accent",
};

/** The 2px rail is the only severity signal a scrolled thread needs. */
const SEVERITY_RAIL: Record<ReviewSeverity, string> = {
  blocking: "border-l-danger",
  warning: "border-l-fg-muted",
  nitpick: "border-l-line-strong",
  praise: "border-l-accent",
};

/**
 * One review finding rendered under the line it cites. Text and severity only;
 * never a Reply control (nothing is published).
 */
export function FindingThread({ finding }: { finding: ReviewFinding }) {
  const { artifact } = useReviewFindings();
  const when = artifact ? formatAgo(artifact.createdAt) : "";

  return (
    <div
      data-finding-id={finding.id}
      className="border-b border-line bg-surface"
    >
      <div
        className={cx(
          "border-l-2 px-3 py-2",
          SEVERITY_RAIL[finding.severity] ?? "border-l-line-strong",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full border border-line text-fg-faint">
            <Sparkles className="size-3" aria-hidden />
          </span>
          <span className="text-meta font-medium text-fg-body">
            triage review
          </span>
          <span
            className={cx(
              "inline-flex h-4.5 shrink-0 items-center rounded-sm border px-1 font-mono text-micro",
              SEVERITY_TAG[finding.severity] ?? "border-line text-fg-faint",
            )}
          >
            {finding.severity}
          </span>
          {finding.anchored ? null : (
            <span className="shrink-0 text-micro text-fg-faint">
              no exact line
            </span>
          )}
          {when ? (
            <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint">
              {when}
            </span>
          ) : null}
        </div>

        <h3 className="mt-1 text-ui font-medium text-fg">{finding.title}</h3>
        <p className="mt-0.5 max-w-[72ch] text-meta leading-4.5 text-fg-muted">
          {finding.claim}
        </p>
        {finding.suggestion ? (
          <p className="mt-1 max-w-[72ch] text-meta leading-4.5 text-fg-body">
            {finding.suggestion}
          </p>
        ) : null}
      </div>
    </div>
  );
}
