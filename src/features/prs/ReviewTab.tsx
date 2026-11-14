import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui";
import { applyFindingPatch, describeError } from "../../lib/api";
import { cx } from "../../lib/cx";
import { formatRelative } from "../../lib/time";
import {
  REVIEW_SEVERITY_ORDER,
  type ActionStatus,
  type DiffFile,
  type ReviewFinding,
} from "../../lib/types";
import { FindingCard } from "./FindingCard";
import { FindingGroup } from "./FindingGroup";
import { ReviewVerdict } from "./ReviewVerdict";
import type { ClaudeActionController } from "./useClaudeAction";

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

type StageKey = "worktree" | "diff" | "review";
type StageState = "pending" | "active" | "done";

/**
 * States advance only as status events arrive; there is no progress estimate.
 * `queued` and `preparing` both happen inside the worktree step.
 */
function stageStates(phase: ActionStatus): Record<StageKey, StageState> {
  switch (phase) {
    case "queued":
    case "preparing":
      return { worktree: "active", diff: "pending", review: "pending" };
    case "running":
      return { worktree: "done", diff: "done", review: "active" };
    default:
      return { worktree: "done", diff: "done", review: "done" };
  }
}

function stageWord(state: StageState, phase: ActionStatus): string {
  if (state === "done") return "done";
  if (state === "pending") return "waiting";
  switch (phase) {
    case "queued":
    case "preparing":
    case "running":
    case "validating":
      return phase;
    default:
      return "done";
  }
}

const STAGE_LABELS: Record<StageKey, string> = {
  worktree: "worktree",
  diff: "semantic diff",
  review: "review",
};

const STAGE_DETAILS: Record<StageKey, (number: number) => string> = {
  worktree: (number) => `git fetch origin pull/${number}/head`,
  diff: () => "sem over the changed entities",
  review: () => "haiku 5.5, read-only worktree",
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
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState<string | null>(null);
  const [applyFailure, setApplyFailure] = useState<{
    id: string;
    message: string;
  } | null>(null);

  // One apply at a time. The server serialises them too; this only disables the
  // button so two clicks cannot queue up.
  async function applyFinding(finding: ReviewFinding) {
    const action = controller.action;
    if (!action) return;
    setApplying(finding.id);
    setApplyFailure(null);
    try {
      await applyFindingPatch({
        repo,
        number,
        actionID: action.id,
        findingID: finding.id,
      });
      // The artifact on disk now carries appliedAt. Refetch so a reload and the
      // current page agree.
      await queryClient.invalidateQueries({
        queryKey: ["pr-action", repo, number, action.id],
      });
    } catch (caught) {
      setApplyFailure({ id: finding.id, message: describeError(caught) });
    } finally {
      setApplying(null);
    }
  }

  if (!reviewAvailable) {
    return (
      <section className="max-w-[68ch]">
        <h2 className="text-ui font-medium text-fg">
          Automatic review needs a local clone.
        </h2>
        <p className="mt-2 text-prose text-fg-muted">
          Add this to {configFile}, then restart:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-[4px] border border-line bg-surface px-3 py-2 font-mono text-meta text-fg-body select-all">
          {`  "repoPaths": { "${repo}": "/path/to/clone" }`}
        </pre>
        {unavailableReason ? (
          <p className="mt-2 text-meta text-fg-faint">{unavailableReason}</p>
        ) : null}
      </section>
    );
  }

  const stages = stageStates(phase);
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
        <div
          role="alert"
          className="rounded-[4px] border border-line px-3 py-2"
        >
          <p className="text-prose text-danger">{error}</p>
          <Button variant="outline" onClick={controller.run} className="mt-2">
            Retry
          </Button>
        </div>
      ) : null}

      {running ? (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-ui font-medium text-fg">Automatic review</h2>
            <p className="mt-1 text-meta text-fg-faint">
              Read-only review in a disposable worktree. Nothing is pushed.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {(Object.keys(STAGE_LABELS) as StageKey[]).map((key) => (
              <StageRow
                key={key}
                state={stages[key]}
                word={stageWord(stages[key], phase)}
                label={STAGE_LABELS[key]}
                detail={STAGE_DETAILS[key](number)}
              />
            ))}
            {phase === "validating" ? (
              <StageRow
                state="active"
                word="validating"
                label="validating findings"
                detail="anchors, limits, patches"
              />
            ) : null}
          </div>
          <ReviewSkeleton />
        </div>
      ) : null}

      {canceled ? (
        <p className="text-meta text-fg-faint">Review canceled.</p>
      ) : null}

      {showArtifact && review ? (
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
              <span className="tabular">
                {formatRelative(artifact.createdAt)}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular">
                ${artifact.usage.totalCostUsd.toFixed(2)}
              </span>
            </div>
          ) : null}

          <ReviewVerdict review={review} />

          {review.findings.length === 0 ? (
            <p className="mt-4 text-prose text-fg-faint">
              No issues found in the changed code.
            </p>
          ) : (
            <div className="mt-6 flex flex-col gap-6">
              {REVIEW_SEVERITY_ORDER.map((severity) => {
                const group = review.findings.filter(
                  (finding) => finding.severity === severity,
                );
                return (
                  <FindingGroup
                    key={severity}
                    severity={severity}
                    findings={group}
                  >
                    {group.map((finding) => (
                      <FindingCard
                        key={finding.id}
                        finding={finding}
                        diffFiles={diffFiles}
                        onOpenInDiff={onOpenInDiff}
                        onApply={applyFinding}
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
              {review.omitted} finding{review.omitted === 1 ? "" : "s"} omitted
              to keep the page short.
            </p>
          ) : null}
        </div>
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

function StageRow({
  state,
  word,
  label,
  detail,
}: {
  state: StageState;
  word: string;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        aria-hidden="true"
        className={cx(
          "mb-px size-2 shrink-0 rounded-[2px]",
          state === "done"
            ? "bg-accent"
            : state === "active"
              ? "animate-pulse bg-fg-muted"
              : "border border-line-strong",
        )}
      />
      <span className="w-20 shrink-0 font-mono text-micro text-fg-faint uppercase">
        {word}
      </span>
      <span className="w-28 shrink-0 text-meta text-fg-body">{label}</span>
      <span className="min-w-0 truncate font-mono text-meta text-fg-faint">
        {detail}
      </span>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-[6px] border border-line">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="border-b border-line px-3 py-3 last:border-b-0"
        >
          <div className="h-2 w-24 animate-pulse rounded-[4px] bg-surface" />
          <div className="mt-2 h-3 w-2/3 animate-pulse rounded-[4px] bg-surface" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded-[4px] bg-surface" />
        </div>
      ))}
    </div>
  );
}
