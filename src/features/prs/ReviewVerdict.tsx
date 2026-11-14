import { ShieldCheck, TriangleAlert } from "lucide-react";
import { MicroLabel } from "../../components/ui";
import {
  REVIEW_SEVERITY_ORDER,
  type ReviewDocument,
  type ReviewSeverity,
} from "../../lib/types";

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

/**
 * Verdict banner: label, severity counts, one summary sentence. The label is
 * the server verdict, which already accounts for blocking findings.
 */
export function ReviewVerdict({ review }: { review: ReviewDocument }) {
  const { safeToMerge, summary, overridden } = review.verdict;
  const counts = countSeverities(review.findings);
  const parts = REVIEW_SEVERITY_ORDER.filter(
    (severity) => counts[severity] > 0,
  ).map((severity) => countLabel(severity, counts[severity]));

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="flex items-center gap-2">
          {safeToMerge ? (
            <ShieldCheck className="size-4 text-accent" aria-hidden />
          ) : (
            <TriangleAlert className="size-4 text-danger" aria-hidden />
          )}
          <MicroLabel className={safeToMerge ? "text-accent!" : "text-danger!"}>
            {safeToMerge ? "Safe to merge" : "Needs work"}
          </MicroLabel>
        </span>
        {parts.length > 0 ? (
          <span className="tabular font-mono text-meta text-fg-faint">
            {parts.join(" · ")}
          </span>
        ) : null}
      </div>

      {summary ? (
        <p className="mt-2 max-w-[68ch] text-prose text-fg-body">{summary}</p>
      ) : null}

      {overridden ? (
        <p className="mt-1 text-meta text-fg-faint">
          Verdict corrected: a blocking finding cannot be safe to merge.
        </p>
      ) : null}
    </div>
  );
}
