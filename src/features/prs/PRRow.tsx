import type { PR } from "../../lib/types";
import { formatRelative } from "../../lib/time";
import { StatusIcon } from "../../components/StatusBadge";

type PRRowProps = {
  pr: PR;
  /** Keyboard cursor position. */
  active: boolean;
  /** Committed selection; survives refetches. */
  selected: boolean;
  /** Show the repo name only when the list spans repositories. */
  showRepo: boolean;
  /** Show the author only when the list is not the viewer's own PRs. */
  showAuthor: boolean;
  onPick: () => void;
  elementRef?: (element: HTMLDivElement | null) => void;
};

export function PRRow({
  pr,
  active,
  selected,
  showRepo,
  showAuthor,
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
        "relative flex h-13 w-full cursor-default flex-col justify-center gap-1 border-b border-line pr-3 pl-3 text-left transition-colors outline-none",
        selected
          ? "row-selected"
          : active
            ? "bg-surface/60"
            : "hover:bg-surface/60",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-ui font-medium text-fg">
          {pr.title}
        </p>
        {pr.isDraft ? (
          <span className="shrink-0 text-micro font-medium tracking-[0.06em] text-fg-faint uppercase">
            Draft
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 truncate text-meta">
          {showRepo ? (
            <span className="max-w-32 shrink-0 truncate font-mono text-fg-muted">
              {pr.repo}
            </span>
          ) : null}
          <span className="shrink-0 font-mono text-fg-muted tabular-nums">
            #{pr.number}
          </span>
          {pr.branch ? (
            <span className="min-w-0 flex-1 truncate font-mono text-fg-muted">
              {pr.branch}
            </span>
          ) : null}
          {showAuthor && pr.author ? (
            <>
              <span aria-hidden="true" className="text-fg-faint">
                ·
              </span>
              <span className="shrink-0 truncate text-fg-faint">
                {pr.author}
              </span>
            </>
          ) : null}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <StatusIcon kind="check" state={pr.checkStatus} />
          <StatusIcon kind="review" state={pr.reviewState} />
          <span className="w-12 text-right font-mono text-meta whitespace-nowrap text-fg-faint tabular-nums">
            {formatRelative(pr.updatedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
