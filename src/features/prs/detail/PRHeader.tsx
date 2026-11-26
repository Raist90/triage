import { Sparkles } from "lucide-react";
import { StatusIcon } from "../../../components/StatusBadge";
import { formatRelative } from "../../../lib/time";
import type { PR } from "../../../lib/types";
import { PRStateTag } from "../PRStateTag";
import { prStatus } from "../prStatus";
import { ChangeStat } from "./ChangeStat";

type ReviewStatus = {
  blocking: number;
  warning: number;
  stale: boolean;
};

function reviewStatusLabel(status: ReviewStatus): string {
  if (status.stale) return "Review stale";
  const parts: string[] = [];
  if (status.blocking > 0) parts.push(`${status.blocking} blocking`);
  if (status.warning > 0) parts.push(`${status.warning} warning`);
  return parts.length > 0
    ? `Review found ${parts.join(" · ")}`
    : "Review found no findings";
}

export function PRHeader({
  pr,
  reviewStatus,
}: {
  pr: PR;
  reviewStatus?: ReviewStatus | null;
}) {
  return (
    <header className="shrink-0 header-wash px-4 pt-4 pb-3">
      <h1 className="flex min-w-0 items-baseline gap-2 text-title font-medium tracking-[-0.01em] text-fg">
        <span className="min-w-0">{pr.title}</span>
        <PRStateTag status={prStatus(pr)} />
      </h1>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-meta text-fg-faint">
        <span className="text-fg-muted">{pr.author}</span>
        <span className="tabular-nums">
          updated {formatRelative(pr.updatedAt)}
        </span>
        <span className="font-mono">
          {pr.branch} → {pr.baseBranch}
        </span>
        {pr.commitCount > 0 ? (
          <span className="tabular-nums">{pr.commitCount} commits</span>
        ) : null}
        <span className="flex items-center gap-2 min-[1400px]:hidden">
          <StatusIcon kind="check" state={pr.checkStatus} withLabel />
          <StatusIcon kind="review" state={pr.reviewState} withLabel />
        </span>
        <ChangeStat
          additions={pr.additions}
          deletions={pr.deletions}
          files={pr.changedFiles}
        />
      </div>

      {reviewStatus ? (
        <p className="mt-2 flex items-center gap-1.5 text-meta text-fg-muted">
          <Sparkles className="size-3.5" aria-hidden />
          {reviewStatusLabel(reviewStatus)}
        </p>
      ) : null}
    </header>
  );
}
