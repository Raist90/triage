import {
  ClaudeActionButton,
  ClaudeActionPanel,
} from "../action/ClaudeActionPanel";
import type { ClaudeActionController } from "../action/useClaudeAction";

export function ExplainTab({
  controller,
}: {
  controller: ClaudeActionController;
}) {
  return (
    <section className="mx-auto max-w-[68ch]">
      <div className="mb-3 flex justify-end">
        <ClaudeActionButton controller={controller} />
      </div>
      {!controller.artifact && !controller.running && !controller.error ? (
        <p className="text-prose text-fg-faint">
          Ask Claude to explain this pull request from its diff.
        </p>
      ) : (
        <ClaudeActionPanel controller={controller} />
      )}
    </section>
  );
}
