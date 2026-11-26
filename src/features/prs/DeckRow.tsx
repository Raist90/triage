import { cx } from "../../lib/cx";
import { formatRelative } from "../../lib/time";
import type { PR } from "../../lib/types";
import { isDim, reasonFor, severityFor, type DeckBucketID } from "./deck";

type DeckRowProps = {
  pr: PR;
  optionId: string;
  /** Keyboard cursor position; independent of selection. */
  cursor: boolean;
  /** The open PR. */
  selected: boolean;
  /** Waiting buckets are de-emphasised. */
  tab: string;
  bucket: DeckBucketID;
  /** Show the repo name only when the list spans repositories. */
  showRepo: boolean;
  onPick: () => void;
};

const RAIL: Record<string, string> = {
  blocked: "before:bg-danger",
  warn: "before:bg-fg-muted",
  wait: "before:bg-line-strong",
};

export function DeckRow({
  pr,
  optionId,
  cursor,
  selected,
  tab,
  bucket,
  showRepo,
  onPick,
}: DeckRowProps) {
  const dim = !selected && isDim(pr, tab, bucket);

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={cx(
        "group relative grid w-full cursor-default grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 rounded-sm py-2 pr-2 pl-[11px] text-left transition-colors duration-120",
        "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full",
        selected
          ? "row-selected"
          : cx(
              "hover:bg-surface/70 hover:before:w-[3px]",
              dim ? "before:bg-line" : RAIL[severityFor(pr)],
              cursor && "bg-surface/70 before:w-[3px]",
            ),
      )}
    >
      <span
        className={cx(
          "min-w-0 truncate text-ui transition-colors duration-120",
          dim ? "font-normal text-fg-body" : "font-medium text-fg",
          !selected &&
            "group-hover:text-[color-mix(in_oklab,var(--color-fg)_92%,var(--color-accent))]",
        )}
      >
        {pr.title}
      </span>
      <span className="self-center font-mono text-micro whitespace-nowrap text-fg-faint tabular-nums">
        {formatRelative(pr.updatedAt)}
      </span>
      <span className="col-span-2 flex min-w-0 items-center gap-2 text-meta">
        {showRepo ? (
          <span className="max-w-30 truncate font-mono text-fg-faint">
            {pr.repo}
          </span>
        ) : null}
        <span className="font-mono text-fg-faint tabular-nums">
          #{pr.number}
        </span>
        <span className="min-w-0 truncate text-fg-muted">{reasonFor(pr)}</span>
      </span>
    </div>
  );
}
