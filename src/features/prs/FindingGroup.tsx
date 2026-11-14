import type { ReactNode } from "react";
import { MicroLabel } from "../../components/ui";
import type { ReviewFinding, ReviewSeverity } from "../../lib/types";

type FindingGroupProps = {
  severity: ReviewSeverity;
  findings: ReviewFinding[];
  children: ReactNode;
};

/** Severity heading plus its cards. The caller owns the card list. */
export function FindingGroup({
  severity,
  findings,
  children,
}: FindingGroupProps) {
  if (findings.length === 0) return null;

  return (
    <section aria-label={`${severity} findings`}>
      <div className="flex items-baseline gap-2">
        <MicroLabel>{severity}</MicroLabel>
        <span className="tabular font-mono text-meta text-fg-faint">
          {findings.length}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}
