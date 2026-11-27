import { CircleSlash, FolderGit } from "lucide-react";
import { StatusIcon } from "../../../components/StatusBadge";
import { cx } from "../../../lib/cx";
import { formatRelative } from "../../../lib/time";
import type { PR, ReviewFinding, ReviewSeverity } from "../../../lib/types";
import type { ClaudeActionController } from "../action/useClaudeAction";
import { PublishDraft } from "../review/PublishDraft";
import { ReviewStages } from "../review/ReviewStages";
import { ReviewVerdict } from "../review/ReviewVerdict";

const SEVERITY_RAIL: Record<ReviewSeverity, string> = {
  blocking: "before:bg-danger",
  warning: "before:bg-fg-muted",
  nitpick: "before:bg-line-strong",
  praise: "before:bg-accent",
};

/**
 * Review as a bar section: the PR's GitHub state, the artifact verdict and a
 * compact index of every finding. The finding text lives on its diff line.
 */
export function ReviewSection({
  pr,
  controller,
  reviewAvailable,
  stale: staleOverride,
  unavailableReason,
  configPath,
  onFocusFinding,
}: {
  pr: PR;
  controller: ClaudeActionController;
  /** True when the repository has a local clone the action can use. */
  reviewAvailable: boolean;
  /** Includes the artifact/head comparison owned by PRDetail. */
  stale?: boolean;
  unavailableReason?: string;
  configPath?: string;
  onFocusFinding: (finding: ReviewFinding) => void;
}) {
  const { artifact, error, phase, review, running } = controller;
  const stale = staleOverride ?? controller.stale;
  const current = stale ? undefined : review;
  const canceled = !running && phase === "canceled";
  const configFile = configPath ?? "~/.triage/config.json";

  return (
    <section aria-label="Review">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-micro font-medium tracking-[0.08em] text-fg-faint uppercase">
          Review
        </span>
        {artifact ? (
          <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint">
            {artifact.model} · {formatRelative(artifact.createdAt)}
          </span>
        ) : (
          <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint">
            on demand
          </span>
        )}
      </div>

      {pr.reviewState !== "none" ? (
        <div className="mb-2">
          <StatusIcon kind="review" state={pr.reviewState} withLabel />
        </div>
      ) : null}

      {!reviewAvailable ? (
        <>
          <p className="flex items-start gap-2 text-meta leading-4.5 text-fg-faint">
            <FolderGit className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Automatic review needs a local clone. Add this to{" "}
              <span className="font-mono">{configFile}</span>, then restart.
            </span>
          </p>
          <pre className="mt-2 overflow-x-auto rounded-sm border border-line bg-surface px-2 py-1.5 font-mono text-micro text-fg-body select-all">
            {`  "repoPaths": { "${pr.repo}": "/path/to/clone" }`}
          </pre>
          {unavailableReason ? (
            <p className="mt-1 text-micro text-fg-faint">{unavailableReason}</p>
          ) : null}
        </>
      ) : error ? (
        <div
          role="alert"
          className="flex items-start gap-2 text-meta text-danger"
        >
          <CircleSlash className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Review failed. {error}</span>
        </div>
      ) : running ? (
        <ReviewStages phase={phase} number={pr.number} />
      ) : current ? (
        <>
          {stale ? (
            <p className="mb-2 text-meta text-fg-faint">
              This review is from an older commit. Re-run to refresh it.
            </p>
          ) : (
            <ReviewVerdict review={current} />
          )}

          {current.findings.length > 0 ? (
            <div className="mt-2 flex flex-col">
              {current.findings.map((finding) => (
                <button
                  key={finding.id}
                  type="button"
                  onClick={() => onFocusFinding(finding)}
                  title={`${finding.file}:${finding.line} · ${finding.title}`}
                  className={cx(
                    "relative flex flex-col gap-0.5 border-b border-line/55 py-1.5 pr-0 pl-3 text-left last:border-b-0",
                    "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full",
                    SEVERITY_RAIL[finding.severity] ?? "before:bg-line-strong",
                  )}
                >
                  <span className="truncate font-mono text-micro text-fg-faint">
                    {finding.file}:{finding.line}
                  </span>
                  <span className="truncate text-meta text-fg-body">
                    {finding.title}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-meta text-fg-faint">
              {current.unverified
                ? "No finding could be verified against the changed code."
                : "No issues found in the changed code."}
            </p>
          )}

          {current.omitted ? (
            <p className="mt-2 text-micro text-fg-faint">
              {current.omitted} finding{current.omitted === 1 ? "" : "s"}{" "}
              omitted to keep the page short.
            </p>
          ) : null}
          {current.unverified ? (
            <p className="mt-1 text-micro text-fg-faint">
              {current.unverified} unverified finding
              {current.unverified === 1 ? "" : "s"} hidden
              {current.unverifiedBlocking
                ? ` (${current.unverifiedBlocking} blocking, verdict stays conservative)`
                : ""}
              .
            </p>
          ) : null}

          {pr.state === "open" && controller.action ? (
            <PublishDraft
              repo={pr.repo}
              number={pr.number}
              actionID={controller.action.id}
              findings={current.findings}
              pending={pr.pendingReview === true}
            />
          ) : null}
        </>
      ) : stale || canceled ? (
        <p className="text-meta text-fg-faint">
          {canceled
            ? "Review canceled."
            : "This review is from an older commit. Re-run to refresh it."}
        </p>
      ) : (
        <p className="text-meta leading-4.5 text-fg-faint">
          No automatic review on{" "}
          <span className="font-mono">{pr.headSHA.slice(0, 7)}</span> yet. Start
          review to anchor findings as comments on the diff.
        </p>
      )}
    </section>
  );
}
