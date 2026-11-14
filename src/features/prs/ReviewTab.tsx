import { Sparkles, X } from "lucide-react";
import { Button, MicroLabel } from "../../components/ui";
import { cx } from "../../lib/cx";
import type {
  ActionStatus,
  DiffFile,
  ReviewDocument,
  ReviewSeverity,
} from "../../lib/types";
import type { ClaudeActionController } from "./useClaudeAction";

type ReviewTabProps = {
  repo: string;
  number: number;
  controller: ClaudeActionController;
  reviewAvailable: boolean;
  unavailableReason?: string;
  configPath?: string;
  /** Reserved for C5/C6: findings are matched against the PR diff. */
  repoPath?: string;
  diffFiles?: DiffFile[];
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
}: ReviewTabProps) {
  const { artifact, error, phase, review, running, stale } = controller;
  const configFile = configPath ?? "~/.triage/config.json";

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
        <div className="flex flex-col gap-3">
          {stale ? (
            <p className="text-meta text-fg-faint">
              This review is from an older commit. Re-run to refresh it.
            </p>
          ) : null}
          <VerdictLine review={review} />
          <p className="text-meta text-fg-faint">
            <span className="tabular font-mono">{review.findings.length}</span>{" "}
            finding{review.findings.length === 1 ? "" : "s"}
            {review.omitted
              ? ` · ${review.omitted} omitted by the server`
              : null}
          </p>
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

const SEVERITY_ORDER: ReviewSeverity[] = [
  "blocking",
  "warning",
  "nitpick",
  "praise",
];

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

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * C4 keeps the verdict to one line. C5 replaces this with the full banner and
 * the severity groups below it.
 */
function VerdictLine({ review }: { review: ReviewDocument }) {
  const counts = countSeverities(review.findings);
  const parts = SEVERITY_ORDER.filter(
    (severity) => severity !== "praise" || counts.praise > 0,
  ).map((severity) => {
    const count = counts[severity];
    switch (severity) {
      case "warning":
        return plural(count, "warning", "warnings");
      case "nitpick":
        return plural(count, "nitpick", "nitpicks");
      default:
        return plural(count, severity, severity);
    }
  });
  const safe = review.verdict.safeToMerge;

  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <MicroLabel className={safe ? "text-accent!" : "text-danger!"}>
        {safe ? "Safe to merge" : "Needs work"}
      </MicroLabel>
      <span className="tabular font-mono text-meta text-fg-muted">
        {parts.join(" · ")}
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
