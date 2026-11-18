import { Check, Copy } from "lucide-react";
import { useRef } from "react";
import { StatusIcon } from "../../../components/StatusBadge";
import { cx } from "../../../lib/cx";
import type { PR, PRDiffResponse } from "../../../lib/types";
import { useCopy } from "../../../lib/useCopy";
import { scrollEdgeClass, useScrollEdges } from "../../../lib/useScrollEdges";
import { ComplexityMeter } from "./ComplexityMeter";

type ContextRailProps = {
  pr: PR;
  diff?: PRDiffResponse;
};

export function ContextRail({ pr, diff }: ContextRailProps) {
  const railRef = useRef<HTMLElement | null>(null);
  const scrollEdges = useScrollEdges(railRef);
  const { copied, copy } = useCopy(pr.headSHA);

  return (
    <aside
      aria-label="Pull request context"
      ref={railRef}
      className={cx(
        "hidden w-68 shrink-0 flex-col overflow-y-auto border-l border-line p-4 min-[1400px]:flex",
        scrollEdgeClass(scrollEdges),
      )}
    >
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-4 text-meta">
        <dt className="text-fg-faint">Status</dt>
        <dd className="flex flex-col gap-2 text-fg-muted">
          {pr.checkStatus !== "none" ? (
            <StatusIcon kind="check" state={pr.checkStatus} withLabel />
          ) : null}
          {pr.reviewState !== "none" ? (
            <StatusIcon kind="review" state={pr.reviewState} withLabel />
          ) : null}
          {pr.checkStatus === "none" && pr.reviewState === "none" ? (
            <span className="text-fg-faint">No checks or reviews</span>
          ) : null}
        </dd>

        {diff?.complexity ? (
          <>
            <dt className="text-fg-faint">Complexity</dt>
            <dd className="text-fg-muted">
              <ComplexityMeter complexity={diff.complexity} />
            </dd>
          </>
        ) : null}

        <dt className="text-fg-faint">Commit</dt>
        <dd className="flex items-center gap-1 text-fg-muted">
          <span className="font-mono tabular-nums">
            {pr.headSHA.slice(0, 7)}
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            title={copied ? "Copied" : "Copy commit SHA"}
            aria-label={copied ? "Copied" : "Copy commit SHA"}
            className="-my-1 flex size-5 items-center justify-center rounded-sm text-fg-faint transition-colors hover:bg-surface hover:text-fg"
          >
            {copied ? (
              <Check className="size-3.5 text-accent" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
          </button>
        </dd>
      </dl>
    </aside>
  );
}
