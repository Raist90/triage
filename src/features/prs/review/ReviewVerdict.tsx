import { ShieldCheck, TriangleAlert } from "lucide-react";
import { cx } from "../../../lib/cx";
import {
  REVIEW_SEVERITY_ORDER,
  type ReviewDocument,
  type ReviewSeverity,
} from "../../../lib/types";

/** "3 blocking", "1 warning", "2 nitpicks". */
function countLabel(severity: ReviewSeverity, count: number): string {
  switch (severity) {
    case "warning":
      return `${count} ${count === 1 ? "warning" : "warnings"}`;
    case "nitpick":
      return `${count} ${count === 1 ? "nitpick" : "nitpicks"}`;
    default:
      return `${count} ${severity}`;
  }
}

function countSeverities(
  findings: ReviewDocument["findings"],
): Record<ReviewSeverity, number> {
  const counts: Record<ReviewSeverity, number> = {
    blocking: 0,
    warning: 0,
    nitpick: 0,
    praise: 0,
  };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

const SEVERITY_BAR: Record<ReviewSeverity, string> = {
  blocking: "bg-danger",
  warning: "bg-fg-muted",
  nitpick: "bg-fg-faint",
  praise: "bg-accent",
};

/**
 * Verdict banner: the server verdict is the headline, the severity mix is one
 * proportional strip under it, and the summary is prose.
 */
export function ReviewVerdict({ review }: { review: ReviewDocument }) {
  const { safeToMerge, summary, overridden } = review.verdict;
  const counts = countSeverities(review.findings);
  const total = review.findings.length;
  const parts = REVIEW_SEVERITY_ORDER.filter(
    (severity) => counts[severity] > 0,
  ).map((severity) => countLabel(severity, counts[severity]));

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cx(
            "flex items-center gap-2 text-lead font-medium",
            safeToMerge ? "text-accent" : "text-danger",
          )}
        >
          {safeToMerge ? (
            <ShieldCheck className="size-4" aria-hidden />
          ) : (
            <TriangleAlert className="size-4" aria-hidden />
          )}
          {safeToMerge ? "Safe to merge" : "Needs work"}
        </span>
        {parts.length > 0 ? (
          <span className="font-mono text-meta text-fg-faint tabular-nums">
            {parts.join(" · ")}
          </span>
        ) : null}
      </div>

      {total > 0 ? (
        <div aria-hidden="true" className="mt-3 flex h-1 gap-1">
          {REVIEW_SEVERITY_ORDER.map((severity) =>
            counts[severity] > 0 ? (
              <span
                key={severity}
                style={{ flexGrow: counts[severity] }}
                className={cx("h-1 rounded-full", SEVERITY_BAR[severity])}
              />
            ) : null,
          )}
        </div>
      ) : null}

      {summary ? (
        <p className="mt-3 max-w-[68ch] text-prose text-fg-body">{summary}</p>
      ) : null}

      {overridden ? (
        <p className="mt-1 text-meta text-fg-faint">
          Verdict corrected: a blocking finding cannot be safe to merge.
        </p>
      ) : null}
    </div>
  );
}
