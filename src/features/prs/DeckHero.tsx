import { FileDiff, MessageSquareWarning, SkipForward } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui";
import { cx } from "../../lib/cx";
import { formatRelative } from "../../lib/time";
import type { PR } from "../../lib/types";
import { reasonFor } from "./deck";

type DeckHeroProps = {
  pr: PR;
  kind: "ready" | "draft";
  optionId: string;
  cursor: boolean;
  selected: boolean;
  onOpenPR: () => void;
  onOpenDiff: () => void;
  onSkip: () => void;
};

function Fact({
  children,
  tone,
  plain,
}: {
  children: ReactNode;
  tone?: "danger" | "accent";
  plain?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] items-center gap-1 rounded-sm border px-1 font-mono text-micro whitespace-nowrap",
        plain
          ? "border-transparent px-0 text-fg-faint"
          : "border-line text-fg-faint",
        tone === "danger" && "border-danger/30 bg-danger/8 text-danger",
        tone === "accent" && "border-accent/30 bg-accent/8 text-accent",
      )}
    >
      {children}
    </span>
  );
}

/**
 * One loud row, not a card. The option covers title, reason and facts; the
 * action buttons are siblings of the option, never its descendants.
 */
export function DeckHero({
  pr,
  kind,
  optionId,
  cursor,
  selected,
  onOpenPR,
  onOpenDiff,
  onSkip,
}: DeckHeroProps) {
  const draft = kind === "draft";
  const summary = pr.reviewSummary;

  return (
    <article
      className={cx(
        "group relative mx-2 mt-2 mb-3 rounded-sm py-3 pr-2 pl-[11px] transition-colors duration-120",
        "before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full",
        selected
          ? "row-selected"
          : cx(
              "hover:bg-surface/70",
              draft ? "before:bg-line-strong" : "before:bg-accent",
            ),
      )}
    >
      <div
        id={optionId}
        role="option"
        aria-selected={selected}
        onClick={onOpenPR}
        className={cx(
          "block w-full cursor-default rounded-sm text-left outline-none",
          cursor &&
            !selected &&
            "outline-1 -outline-offset-1 outline-line-strong/80",
        )}
      >
        <div className="mb-2 flex items-center gap-2">
          <span
            className={cx(
              "text-micro font-medium tracking-[0.08em] uppercase",
              draft ? "text-fg-muted" : "text-accent",
            )}
          >
            {draft ? "Draft" : "Up next"}
          </span>
          <span className="ml-auto font-mono text-micro text-fg-faint tabular-nums">
            updated {formatRelative(pr.updatedAt)}
          </span>
        </div>

        <h2
          className={cx(
            "text-lead font-medium tracking-[-0.01em] text-fg transition-colors duration-120",
            !selected &&
              "group-hover:text-[color-mix(in_oklab,var(--color-fg)_88%,var(--color-accent))]",
          )}
        >
          {pr.title}
        </h2>

        <p className="mt-1.5 flex min-w-0 items-baseline gap-1.5 text-meta text-fg-muted">
          <span className="truncate">{draft ? "draft" : reasonFor(pr)}</span>
          <span aria-hidden="true" className="text-fg-faint">
            ·
          </span>
          <span className="truncate font-mono">
            {pr.repo}#{pr.number}
          </span>
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {draft ? (
            <Fact>draft</Fact>
          ) : summary ? (
            summary.stale ? (
              <Fact>review stale</Fact>
            ) : (
              <>
                {summary.blocking > 0 ? (
                  <Fact tone="danger">
                    <MessageSquareWarning className="size-2.5" aria-hidden />
                    {summary.blocking} blocking
                  </Fact>
                ) : null}
                {summary.warning > 0 ? (
                  <Fact>{summary.warning} warning</Fact>
                ) : null}
              </>
            )
          ) : null}
          <Fact>{pr.changedFiles} files</Fact>
          <Fact plain>
            <span className="text-accent">+{pr.additions}</span>
            <span>−{pr.deletions}</span>
          </Fact>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          onClick={onOpenPR}
          className="focus-visible:outline-2 focus-visible:outline-accent/55"
        >
          {draft ? "Open draft" : "Open PR"}
        </Button>
        <Button
          variant="outline"
          onClick={onOpenDiff}
          className="focus-visible:outline-2 focus-visible:outline-accent/55"
        >
          <FileDiff className="size-3.5" aria-hidden />
          Open diff
        </Button>
        <Button
          variant="ghost"
          onClick={onSkip}
          title="Move to the next row without opening"
          className="ml-auto focus-visible:outline-2 focus-visible:outline-accent/55"
        >
          <SkipForward className="size-3.5" aria-hidden />
          Skip
        </Button>
      </div>
    </article>
  );
}
