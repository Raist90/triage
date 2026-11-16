import { formatRelative } from "../../../lib/time";
import {
  REVIEW_SEVERITY_ORDER,
  type ActionArtifact,
  type DiffFile,
  type ReviewDocument,
  type ReviewDroppedFinding,
  type ReviewFinding,
} from "../../../lib/types";
import { FindingCard } from "./FindingCard";
import { FindingGroup } from "./FindingGroup";
import type { FindingApplyFailure } from "./useApplyFinding";
import { ReviewVerdict } from "./ReviewVerdict";

/** Reasons that reject a finding outright, as opposed to grounding or budget. */
const RULE_DROP_REASONS = [
  "guideline_mismatch",
  "severity_rule",
  "invalid_field",
];

const RULE_DROP_LABELS: Record<string, string> = {
  guideline_mismatch: "guideline mismatch",
  severity_rule: "severity rule",
  invalid_field: "invalid field",
};

function summarizeDrops(findings: ReviewDroppedFinding[]): string {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.reason, (counts.get(finding.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => {
      const label = RULE_DROP_LABELS[reason] ?? reason.replace(/_/g, " ");
      return `${count} ${label}`;
    })
    .join(", ");
}

type ReviewFindingsProps = {
  review: ReviewDocument;
  artifact?: ActionArtifact;
  stale: boolean;
  diffFiles?: DiffFile[];
  onOpenInDiff?: (finding: ReviewFinding) => void;
  onApply: (finding: ReviewFinding) => void;
  applying: string | null;
  applyFailure: FindingApplyFailure | null;
};

/** Verdict, grouped findings, and the counts behind hidden findings. */
export function ReviewFindings({
  review,
  artifact,
  stale,
  diffFiles,
  onOpenInDiff,
  onApply,
  applying,
  applyFailure,
}: ReviewFindingsProps) {
  const ruleDrops = (review.dropped ?? []).filter((finding) =>
    RULE_DROP_REASONS.includes(finding.reason),
  );

  return (
    <div>
      {stale ? (
        <p className="mb-3 text-meta text-fg-faint">
          This review is from an older commit. Re-run to refresh it.
        </p>
      ) : null}

      {artifact ? (
        <div className="mb-2 flex items-center gap-2 font-mono text-meta text-fg-faint">
          <span>{artifact.model}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {formatRelative(artifact.createdAt)}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            ${artifact.usage.totalCostUsd.toFixed(2)}
          </span>
        </div>
      ) : null}

      <ReviewVerdict review={review} />

      {review.findings.length === 0 ? (
        <p className="mt-4 text-prose text-fg-faint">
          {review.unverified
            ? "No finding could be verified against the changed code."
            : "No issues found in the changed code."}
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {REVIEW_SEVERITY_ORDER.map((severity) => {
            const group = review.findings.filter(
              (finding) => finding.severity === severity,
            );
            return (
              <FindingGroup key={severity} severity={severity} findings={group}>
                {group.map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    diffFiles={diffFiles}
                    onOpenInDiff={onOpenInDiff}
                    onApply={onApply}
                    applying={applying === finding.id}
                    applyError={
                      applyFailure?.id === finding.id
                        ? applyFailure.message
                        : undefined
                    }
                    worktree={artifact?.worktree}
                  />
                ))}
              </FindingGroup>
            );
          })}
        </div>
      )}

      {review.omitted ? (
        <p className="mt-4 text-meta text-fg-faint">
          {review.omitted} finding{review.omitted === 1 ? "" : "s"} omitted to
          keep the page short.
        </p>
      ) : null}

      {review.unverified ? (
        <p className="mt-2 text-meta text-fg-faint">
          {review.unverified} finding
          {review.unverified === 1 ? "" : "s"} could not be verified against the
          changed code and {review.unverified === 1 ? "was" : "were"} hidden.
          {review.unverifiedBlocking
            ? ` ${review.unverifiedBlocking} of them ${
                review.unverifiedBlocking === 1 ? "was" : "were"
              } blocking, so the verdict stays conservative.`
            : ""}
        </p>
      ) : null}

      {ruleDrops.length ? (
        <p className="mt-2 text-meta text-fg-faint">
          {ruleDrops.length} finding
          {ruleDrops.length === 1 ? "" : "s"} hidden before display (
          {summarizeDrops(ruleDrops)}).
        </p>
      ) : null}
    </div>
  );
}
