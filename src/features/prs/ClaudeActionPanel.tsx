import { Sparkles, X } from "lucide-react";
import { Markdown } from "../../components/Markdown";
import { formatRelative } from "../../lib/time";
import type { ClaudeActionController } from "./useClaudeAction";

export function ClaudeActionButton({
  controller,
}: {
  controller: ClaudeActionController;
}) {
  const { action, enabled, running } = controller;
  if (!enabled || !action) return null;

  if (running) {
    return (
      <button
        type="button"
        onClick={controller.cancel}
        title="Cancel"
        className="flex shrink-0 items-center gap-2 rounded-[4px] px-2 py-1 text-meta text-accent transition-colors hover:bg-surface"
      >
        <X className="size-4 animate-pulse" aria-hidden />
        {action.label}…
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={controller.run}
      className="flex shrink-0 items-center gap-2 rounded-[4px] px-2 py-1 text-meta text-fg-muted transition-colors hover:bg-surface hover:text-fg"
    >
      <Sparkles className="size-4" aria-hidden />
      {action.label}
    </button>
  );
}

export function ClaudeActionPanel({
  controller,
}: {
  controller: ClaudeActionController;
}) {
  const { action, artifact, error, liveText, running, stale } = controller;
  if (!action) return null;

  const body = running ? liveText : artifact?.markdown;
  const hasContent = Boolean(body?.trim());
  if (!hasContent && !running && !error) return null;

  return (
    <section>
      {artifact ? (
        <div className="mb-2 flex items-center gap-2 font-mono text-meta text-fg-faint">
          <span>{artifact.model}</span>
          <span aria-hidden>·</span>
          <span className="tabular">{formatRelative(artifact.createdAt)}</span>
          <span aria-hidden>·</span>
          <span className="tabular">
            ${artifact.usage.totalCostUsd.toFixed(2)}
          </span>
        </div>
      ) : null}

      {stale ? (
        <p className="mb-2 text-meta text-fg-faint">
          This answer is from an older commit. Re-run to refresh it.
        </p>
      ) : null}

      {error ? (
        <p className="text-prose text-danger">{error}</p>
      ) : hasContent ? (
        <Markdown>{body ?? ""}</Markdown>
      ) : (
        <p className="text-prose text-fg-faint">Waiting for Claude…</p>
      )}
    </section>
  );
}
