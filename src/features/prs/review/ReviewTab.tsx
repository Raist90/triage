import { CircleSlash, FolderGit, Sparkles, X } from "lucide-react";
import { StateView } from "../../../components/StateView";
import { Button } from "../../../components/ui";
import type { DiffFile, ReviewFinding } from "../../../lib/types";
import type { ClaudeActionController } from "../action/useClaudeAction";
import { usePRDetailContext } from "../detail/PRDetailContext";
import { ReviewFindings } from "./ReviewFindings";
import { ReviewStages } from "./ReviewStages";
import { useApplyFinding } from "./useApplyFinding";

type ReviewTabProps = {
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
  controller,
  reviewAvailable,
  unavailableReason,
  configPath,
  diffFiles,
  onOpenInDiff,
}: ReviewTabProps) {
  const { repo, number } = usePRDetailContext();
  const { artifact, error, phase, review, running, stale } = controller;
  const configFile = configPath ?? "~/.triage/config.json";
  const { applying, failure, apply } = useApplyFinding(
    repo,
    number,
    controller.action,
  );

  if (!reviewAvailable) {
    return (
      <StateView
        layout="inline"
        icon={FolderGit}
        title="Automatic review needs a local clone"
        description={
          <>
            Add this to <span className="font-mono">{configFile}</span>, then
            restart.
          </>
        }
        footnote={unavailableReason}
      >
        <pre className="max-w-full overflow-x-auto rounded-sm border border-line bg-surface px-3 py-2 text-left font-mono text-meta text-fg-body select-all">
          {`  "repoPaths": { "${repo}": "/path/to/clone" }`}
        </pre>
      </StateView>
    );
  }

  const showArtifact = artifact !== undefined && !running;
  const showEmpty = !running && !artifact && !error;
  const canceled = !running && phase === "canceled";

  return (
    <section className="mx-auto flex w-full max-w-[68ch] flex-col gap-3">
      {running || artifact ? (
        <div className="flex min-h-7 justify-end">
          {running ? (
            <Button variant="ghost" onClick={controller.cancel}>
              <X className="size-4 animate-pulse" aria-hidden />
              Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={controller.run}>
              <Sparkles className="size-3.5" aria-hidden />
              Re-run
            </Button>
          )}
        </div>
      ) : null}

      {error ? (
        <StateView
          role="alert"
          layout="inline"
          tone="danger"
          icon={CircleSlash}
          title="Review failed"
          description={error}
          action={
            <Button variant="outline" onClick={controller.run}>
              Retry
            </Button>
          }
        />
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
        <StateView
          layout="inline"
          icon={Sparkles}
          title="Review this pull request"
          description="A read-only pass over the diff and your repository guidelines. Nothing is pushed."
          action={
            <Button variant="primary" onClick={controller.run}>
              <Sparkles className="size-3.5" aria-hidden />
              Run review
            </Button>
          }
          footnote={<span className="font-mono">haiku 5.5 · ~$1 · ~2 min</span>}
        />
      ) : null}
    </section>
  );
}
