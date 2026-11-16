import { Sparkles, X } from "lucide-react";
import { Button } from "../../../components/ui";
import type { DiffFile, ReviewFinding } from "../../../lib/types";
import type { ClaudeActionController } from "../action/useClaudeAction";
import { ReviewFindings } from "./ReviewFindings";
import { ReviewStages } from "./ReviewStages";
import { useApplyFinding } from "./useApplyFinding";

type ReviewTabProps = {
  repo: string;
  number: number;
  controller: ClaudeActionController;
  reviewAvailable: boolean;
  unavailableReason?: string;
  configPath?: string;
  /** Hunk snippets and jumps match findings against the PR diff. */
  diffFiles?: DiffFile[];
  /** Switch to the Diff tab and land on this finding's hunk. */
  onOpenInDiff?: (finding: ReviewFinding) => void;
};

export function ReviewTab({
  repo,
  number,
  controller,
  reviewAvailable,
  unavailableReason,
  configPath,
  diffFiles,
  onOpenInDiff,
}: ReviewTabProps) {
  const { artifact, error, phase, review, running, stale } = controller;
  const configFile = configPath ?? "~/.triage/config.json";
  const { applying, failure, apply } = useApplyFinding(
    repo,
    number,
    controller.action,
  );

  if (!reviewAvailable) {
    return (
      <section className="max-w-[68ch]">
        <h2 className="text-ui font-medium text-fg">
          Automatic review needs a local clone.
        </h2>
        <p className="mt-2 text-prose text-fg-muted">
          Add this to {configFile}, then restart:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-sm border border-line bg-surface px-3 py-2 font-mono text-meta text-fg-body select-all">
          {`  "repoPaths": { "${repo}": "/path/to/clone" }`}
        </pre>
        {unavailableReason ? (
          <p className="mt-2 text-meta text-fg-faint">{unavailableReason}</p>
        ) : null}
      </section>
    );
  }

  const showArtifact = artifact !== undefined && !running;
  const showEmpty = !running && !artifact && !error;
  const canceled = !running && phase === "canceled";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-7 justify-end">
        {running ? (
          <Button variant="ghost" onClick={controller.cancel}>
            <X className="size-4 animate-pulse" aria-hidden />
            Cancel
          </Button>
        ) : artifact ? (
          <Button variant="outline" onClick={controller.run}>
            <Sparkles className="size-3.5" aria-hidden />
            Re-run
          </Button>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-sm border border-line px-3 py-2">
          <p className="text-prose text-danger">{error}</p>
          <Button variant="outline" onClick={controller.run} className="mt-2">
            Retry
          </Button>
        </div>
      ) : null}

      {running ? <ReviewStages phase={phase} number={number} /> : null}

      {canceled ? (
        <p className="text-meta text-fg-faint">Review canceled.</p>
      ) : null}

      {showArtifact && review ? (
        <ReviewFindings
          review={review}
          artifact={artifact}
          stale={stale}
          diffFiles={diffFiles}
          onOpenInDiff={onOpenInDiff}
          onApply={apply}
          applying={applying}
          applyFailure={failure}
        />
      ) : null}

      {showEmpty ? (
        <div className="max-w-[68ch]">
          <h2 className="text-ui font-medium text-fg">Automatic review</h2>
          <p className="mt-1 text-prose text-fg-muted">
            Read-only review in a disposable worktree. Nothing is pushed.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={controller.run}>
              <Sparkles className="size-3.5" aria-hidden />
              Run review
            </Button>
            <span className="font-mono text-meta text-fg-faint">
              haiku 5.5 · ~$1 · ~2 min
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
