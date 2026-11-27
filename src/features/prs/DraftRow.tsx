import { cx } from "../../lib/cx";
import { formatRelative } from "../../lib/time";
import type { PR } from "../../lib/types";

type DraftRowProps = {
  pr: PR;
  optionId: string;
  cursor: boolean;
  selected: boolean;
  onPick: () => void;
};

/** A compact draft row: neutral rail, no severity, no reason, no facts. */
export function DraftRow({
  pr,
  optionId,
  cursor,
  selected,
  onPick,
}: DraftRowProps) {
  return (
    <div
      id={optionId}
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={cx(
        "group relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-[11px] text-left transition-colors duration-120",
        "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full",
        selected
          ? "row-selected text-fg"
          : cx(
              "text-fg-muted before:bg-line-strong hover:bg-surface/70 hover:text-fg",
              cursor && "bg-surface/70 text-fg",
            ),
      )}
    >
      <span className="shrink-0 rounded-sm border border-line px-1 font-mono text-micro text-fg-faint">
        draft
      </span>
      <span className="min-w-0 flex-1 truncate text-ui transition-colors duration-120 group-hover:text-fg">
        {pr.title}
      </span>
      <span className="shrink-0 font-mono text-micro text-fg-faint tabular-nums">
        #{pr.number}
      </span>
      <span className="shrink-0 font-mono text-micro whitespace-nowrap text-fg-faint tabular-nums">
        {formatRelative(pr.updatedAt)}
      </span>
    </div>
  );
}
