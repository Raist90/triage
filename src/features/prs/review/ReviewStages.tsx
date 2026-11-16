import { cx } from "../../../lib/cx";
import type { ActionStatus } from "../../../lib/types";

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

type ReviewStagesProps = {
  phase: ActionStatus;
  number: number;
};

/** Live progress for a running review: worktree, semantic diff, review. */
export function ReviewStages({ phase, number }: ReviewStagesProps) {
  const stages = stageStates(phase);
  return (
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
            detail="evidence, limits, guidelines"
          />
        ) : null}
      </div>
      <ReviewSkeleton />
    </div>
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
    <div aria-hidden="true" className="rounded-md border border-line">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="border-b border-line p-3 last:border-b-0">
          <div className="h-2 w-24 animate-pulse rounded-sm bg-surface" />
          <div className="mt-2 h-3 w-2/3 animate-pulse rounded-sm bg-surface" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded-sm bg-surface" />
        </div>
      ))}
    </div>
  );
}
