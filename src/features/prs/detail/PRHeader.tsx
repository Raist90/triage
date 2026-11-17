import { StatusIcon } from "../../../components/StatusBadge";
import { formatRelative } from "../../../lib/time";
import type { PR } from "../../../lib/types";
import { PRStateTag } from "../PRStateTag";
import { prStatus } from "../prStatus";
import { ChangeStat } from "./ChangeStat";

export function PRHeader({ pr }: { pr: PR }) {
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
    </header>
  );
}
