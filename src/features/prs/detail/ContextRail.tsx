import { ExternalLink } from "lucide-react";
import { StatusIcon } from "../../../components/StatusBadge";
import { Button, MicroLabel } from "../../../components/ui";
import { openExternal } from "../../../lib/open";
import type { PR, PRDiffResponse } from "../../../lib/types";
import { ChangeStat } from "./ChangeStat";
import { ComplexityMeter } from "./ComplexityMeter";

type ContextRailProps = {
  pr: PR;
  diff?: PRDiffResponse;
};

export function ContextRail({ pr, diff }: ContextRailProps) {
  return (
    <aside
      aria-label="Pull request context"
      className="hidden w-68 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line px-4 py-3 min-[1400px]:flex"
    >
      <section>
        <MicroLabel>Checks</MicroLabel>
        <div className="mt-2">
          <StatusIcon kind="check" state={pr.checkStatus} withLabel />
        </div>
      </section>

      <section>
        <MicroLabel>Review</MicroLabel>
        <div className="mt-2">
          <StatusIcon kind="review" state={pr.reviewState} withLabel />
        </div>
      </section>

      <section>
        <MicroLabel>Change</MicroLabel>
        <div className="mt-2">
          <ChangeStat
            additions={pr.additions}
            deletions={pr.deletions}
            files={pr.changedFiles}
            className="text-meta text-fg-muted"
          />
        </div>
      </section>

      {diff?.complexity ? (
        <section>
          <MicroLabel>Complexity</MicroLabel>
          <ComplexityMeter complexity={diff.complexity} />
        </section>
      ) : null}

      <section>
        <MicroLabel>Branches</MicroLabel>
        <p className="mt-2 font-mono text-meta break-all text-fg-muted">
          {pr.branch}
          <span className="px-1 text-fg-faint">→</span>
          {pr.baseBranch}
        </p>
      </section>

      <section>
        <MicroLabel>Commit</MicroLabel>
        <p className="mt-2 font-mono text-meta text-fg-muted">
          {pr.headSHA.slice(0, 7)}
        </p>
      </section>

      <section>
        <MicroLabel>Opened by</MicroLabel>
        <p className="mt-2 text-meta text-fg-muted">{pr.author}</p>
      </section>

      <section className="mt-auto pt-2">
        <Button
          variant="outline"
          onClick={() => void openExternal(pr.url)}
          className="w-full justify-center"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          Open on GitHub
        </Button>
      </section>
    </aside>
  );
}
