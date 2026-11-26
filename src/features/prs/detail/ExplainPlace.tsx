import { CircleSlash, Sparkles, X } from "lucide-react";
import { Markdown } from "../../../components/Markdown";
import { StateView } from "../../../components/StateView";
import { Button } from "../../../components/ui";
import { formatRelative } from "../../../lib/time";
import type { ClaudeActionController } from "../action/useClaudeAction";

/**
 * Explain as a place: empty, running, artifact, stale and error each own the
 * whole body instead of sharing a pane with a bare button.
 */
export function ExplainPlace({
  controller,
}: {
  controller: ClaudeActionController;
}) {
  const { action, artifact, error, liveText, running, stale } = controller;
  if (!action) return null;

  if (error) {
    return (
      <StateView
        role="alert"
        tone="danger"
        icon={CircleSlash}
        title="Explain failed"
        description={error}
        action={
          <Button variant="outline" onClick={controller.run}>
            Retry
          </Button>
        }
      />
    );
  }

  if (running) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-end">
          <Button variant="ghost" onClick={controller.cancel}>
            <X className="size-4 animate-pulse" aria-hidden />
            Cancel
          </Button>
        </div>
        {liveText.trim() ? (
          <Markdown>{liveText}</Markdown>
        ) : (
          <p className="text-prose text-fg-faint">Waiting for Claude…</p>
        )}
      </div>
    );
  }

  if (!artifact) {
    return (
      <StateView
        icon={Sparkles}
        title="No explain artifact for this head"
        description="Generate a plain-language walkthrough of the diff. It runs against the review worktree and never touches GitHub."
        action={
          <Button variant="outline" onClick={controller.run}>
            Explain this PR
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 font-mono text-meta text-fg-faint">
          <span>{artifact.model}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {formatRelative(artifact.createdAt)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            ${artifact.usage.totalCostUsd.toFixed(2)}
          </span>
        </span>
        <Button variant="outline" onClick={controller.run} className="ml-auto">
          <Sparkles className="size-3.5" aria-hidden />
          Re-run
        </Button>
      </div>

      {stale ? (
        <p className="text-meta text-fg-faint">
          This answer is from an older commit. Re-run to refresh it.
        </p>
      ) : null}

      <Markdown>{artifact.markdown}</Markdown>
    </div>
  );
}
