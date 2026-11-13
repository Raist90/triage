import type { PR } from "../../lib/types";
import { formatRelative } from "../../lib/time";
import { StatusIcon } from "../../components/StatusBadge";

type PRRowProps = {
  pr: PR;
  /** Keyboard cursor position. */
  active: boolean;
  /** Committed selection; survives refetches. */
  selected: boolean;
  onPick: () => void;
  elementRef?: (element: HTMLDivElement | null) => void;
};

export function PRRow({
  pr,
  active,
  selected,
  onPick,
  elementRef,
}: PRRowProps) {
  return (
    <div
      ref={elementRef}
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={[
        "relative flex h-[52px] w-full cursor-default flex-col justify-center gap-1 border-b border-line pr-3 pl-3 text-left transition-colors outline-none",
        selected
          ? "bg-surface before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent"
          : active
            ? "bg-surface/60"
            : "hover:bg-surface/40",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-ui font-medium text-fg">{pr.title}</p>
        {pr.isDraft ? (
          <span className="shrink-0 rounded-[3px] border border-line px-1 text-micro tracking-[0.06em] text-fg-faint uppercase">
            Draft
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 truncate text-meta text-fg-faint">
          <span className="max-w-32 truncate">{pr.repo}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular shrink-0 font-mono">#{pr.number}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 flex-1 truncate font-mono">{pr.branch}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 truncate">{pr.author}</span>
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <StatusIcon kind="check" state={pr.checkStatus} />
          <StatusIcon kind="review" state={pr.reviewState} />
          <span className="tabular w-12 text-right font-mono text-meta whitespace-nowrap text-fg-faint">
            {formatRelative(pr.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
