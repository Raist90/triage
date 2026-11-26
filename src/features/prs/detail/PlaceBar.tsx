import { FileDiff, MessageSquare, Play, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui";
import { cx } from "../../../lib/cx";
import type { DetailView } from "../../../stores/ui";
import { ManageMenu } from "./ManageMenu";

type PlaceBarProps = {
  view: DetailView;
  conversationCount: number;
  reviewAvailable: boolean;
  explainAvailable?: boolean;
  onSelect: (view: DetailView) => void;
  onStartReview: () => void;
};

/** The persistent 52px footer: one lit action, the places, and Manage. */
export function PlaceBar({
  view,
  conversationCount,
  reviewAvailable,
  explainAvailable = false,
  onSelect,
  onStartReview,
}: PlaceBarProps) {
  return (
    <div className="flex h-13 shrink-0 items-center gap-2 border-t border-line px-4">
      <Button
        id="place-start-review"
        variant="primary"
        onClick={onStartReview}
        disabled={!reviewAvailable}
        aria-current={view === "review" ? "page" : undefined}
        title={
          reviewAvailable
            ? "Open the review place"
            : "Automatic review is not configured"
        }
      >
        <Play className="size-3.5" aria-hidden />
        Start review
      </Button>

      <PlaceLink
        view="diff"
        active={view === "diff"}
        icon={<FileDiff className="size-3.5" aria-hidden />}
        label="Diff"
        onClick={() => onSelect("diff")}
      />
      <PlaceLink
        view="conversation"
        active={view === "conversation"}
        icon={<MessageSquare className="size-3.5" aria-hidden />}
        label="Conversation"
        count={conversationCount}
        onClick={() => onSelect("conversation")}
      />
      {explainAvailable ? (
        <PlaceLink
          view="explain"
          active={view === "explain"}
          icon={<Sparkles className="size-3.5" aria-hidden />}
          label="Explain"
          onClick={() => onSelect("explain")}
        />
      ) : null}

      <div className="ml-auto flex items-center">
        <ManageMenu />
      </div>
    </div>
  );
}

function PlaceLink({
  view,
  active,
  icon,
  label,
  count,
  onClick,
}: {
  view: DetailView;
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={`place-link-${view}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-meta transition-colors",
        active
          ? "bg-surface text-fg"
          : "text-fg-faint hover:bg-surface hover:text-fg",
      )}
    >
      {icon}
      {label}
      {typeof count === "number" && count > 0 ? (
        <span className="font-mono text-micro text-fg-faint tabular-nums">
          {count}
        </span>
      ) : null}
    </button>
  );
}
