import { Check, Copy, ExternalLink } from "lucide-react";
import { StatusIcon } from "../../../components/StatusBadge";
import { Button } from "../../../components/ui";
import { openExternal } from "../../../lib/open";
import { formatAgo } from "../../../lib/time";
import type { PR } from "../../../lib/types";
import { useCopy } from "../../../lib/useCopy";
import { PRStateTag } from "../PRStateTag";
import { prStatus } from "../prStatus";
import { ChangeStat } from "./ChangeStat";

/**
 * Terminal detail state. Once a PR is merged or closed there is no head left to
 * diff or review, so the live document gives way to the receipt: what landed,
 * where, when.
 * Esc and Back still close the pane.
 */
export function PRSummary({ pr }: { pr: PR }) {
  const status = prStatus(pr);
  if (status !== "merged" && status !== "closed") return null;
  const merged = status === "merged";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="header-wash px-4 pt-5 pb-4">
        <div className="mx-auto w-full max-w-[68ch]">
          <h1 className="flex min-w-0 items-baseline gap-2 text-title font-medium tracking-[-0.01em] text-fg">
            <span className="min-w-0">{pr.title}</span>
            <PRStateTag status={status} />
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-meta text-fg-faint">
            <span className="text-fg-muted">{pr.author}</span>
            <span className="font-mono">
              {pr.branch} → {pr.baseBranch}
            </span>
            <ChangeStat
              additions={pr.additions}
              deletions={pr.deletions}
              files={pr.changedFiles}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[68ch] flex-col gap-5 px-4 py-5">
        <p className="text-ui text-fg">
          {merged ? (
            <>
              Merged into <span className="font-mono">{pr.baseBranch}</span>
              {pr.mergedBy ? (
                <>
                  {" "}
                  by <span className="text-fg-muted">{pr.mergedBy}</span>
                </>
              ) : null}
            </>
          ) : (
            <span className="text-fg-muted">Closed without merging</span>
          )}
        </p>

        <Receipt pr={pr} merged={merged} />

        <p className="text-meta text-fg-faint">
          {merged
            ? "The diff, conversation and review are no longer updated."
            : "The branch was kept. It can be reopened on GitHub."}
        </p>

        <div>
          <Button variant="primary" onClick={() => void openExternal(pr.url)}>
            <ExternalLink className="size-4" aria-hidden />
            Open on GitHub
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The facts of the merge, frozen at the moment it landed. */
function Receipt({ pr, merged }: { pr: PR; merged: boolean }) {
  const sha = pr.mergeCommitSHA ?? "";
  const { copied, copy } = useCopy(sha);

  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-sm border border-line p-3 text-meta">
      {merged && sha ? (
        <>
          <dt className="text-fg-faint">Merge commit</dt>
          <dd className="flex items-center gap-1 text-fg-muted">
            <span className="font-mono tabular-nums">{sha.slice(0, 7)}</span>
            <button
              type="button"
              onClick={() => void copy()}
              title={copied ? "Copied" : "Copy merge commit"}
              aria-label={copied ? "Copied" : "Copy merge commit"}
              className="-my-1 flex size-5 items-center justify-center rounded-sm text-fg-faint transition-colors hover:bg-surface hover:text-fg"
            >
              {copied ? (
                <Check className="size-3.5 text-accent" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
            </button>
          </dd>
        </>
      ) : null}

      {merged && pr.mergedAt ? (
        <>
          <dt className="text-fg-faint">Merged</dt>
          <dd className="text-fg-muted">{formatAgo(pr.mergedAt)}</dd>
        </>
      ) : null}

      {pr.checkStatus !== "none" ? (
        <>
          <dt className="text-fg-faint">Checks</dt>
          <dd>
            <StatusIcon kind="check" state={pr.checkStatus} withLabel />
          </dd>
        </>
      ) : null}

      {pr.reviewState !== "none" ? (
        <>
          <dt className="text-fg-faint">Review</dt>
          <dd>
            <StatusIcon kind="review" state={pr.reviewState} withLabel />
          </dd>
        </>
      ) : null}

      {pr.createdAt ? (
        <>
          <dt className="text-fg-faint">Opened</dt>
          <dd className="text-fg-muted">{formatAgo(pr.createdAt)}</dd>
        </>
      ) : null}

      <dt className="text-fg-faint">Head</dt>
      <dd className="font-mono text-fg-muted tabular-nums">
        {pr.headSHA.slice(0, 7)}
      </dd>
    </dl>
  );
}
