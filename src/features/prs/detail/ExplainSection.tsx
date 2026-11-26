import { CircleSlash, Sparkles, X } from "lucide-react";
import { Markdown } from "../../../components/Markdown";
import { formatRelative } from "../../../lib/time";
import type { ClaudeActionController } from "../action/useClaudeAction";

/**
 * Explanation as a bar section: idle, running, artifact, stale and error, with
 * no inner scroller. The bar itself scrolls.
 */
export function ExplainSection({
  controller,
}: {
  controller: ClaudeActionController;
}) {
  const { action, artifact, error, liveText, running, stale } = controller;
  if (!action) return null;

  return (
    <section aria-label="Explain">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-micro font-medium tracking-[0.08em] text-fg-faint uppercase">
          Explain
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

      {error ? (
        <div role="alert" className="flex flex-col gap-1 text-meta text-danger">
          <span className="flex items-start gap-2">
            <CircleSlash className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>Explain failed. {error}</span>
          </span>
          <button
            type="button"
            onClick={controller.run}
            className="self-start text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-fg"
          >
            Retry
          </button>
        </div>
      ) : running ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-meta text-fg-faint">
            <span>Waiting for Claude…</span>
            <button
              type="button"
              onClick={controller.cancel}
              className="ml-auto inline-flex items-center gap-1 text-fg-muted transition-colors hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
              Cancel
            </button>
          </div>
          {liveText.trim() ? (
            <div className="text-meta text-fg-muted">
              <Markdown>{liveText}</Markdown>
            </div>
          ) : null}
        </div>
      ) : artifact ? (
        <div className="text-meta text-fg-muted">
          {stale ? (
            <p className="mb-2 text-fg-faint">
              This answer is from an older commit. Re-run to refresh it.
            </p>
          ) : null}
          <Markdown>{artifact.markdown}</Markdown>
          <button
            type="button"
            onClick={controller.run}
            className="mt-2 inline-flex items-center gap-1 text-fg-muted transition-colors hover:text-fg"
          >
            <Sparkles className="size-3" aria-hidden />
            Re-run explanation
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-meta leading-4.5 text-fg-faint">
            Walk the change end to end: what it is trying to do, what the diff
            hides, and where the risk sits.
          </p>
          <button
            type="button"
            onClick={controller.run}
            className="inline-flex items-center gap-1 self-start text-meta text-fg-muted transition-colors hover:text-fg"
          >
            <Sparkles className="size-3" aria-hidden />
            Explain this PR
          </button>
        </div>
      )}
    </section>
  );
}
