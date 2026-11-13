import {
  CheckCheck,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  MessageSquareWarning,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { CheckState, ReviewState } from "../lib/types";

type StatusProps =
  | { kind: "check"; state: CheckState; withLabel?: boolean }
  | { kind: "review"; state: ReviewState; withLabel?: boolean };

type Style = { label: string; Icon: LucideIcon; tone: string };

const CHECK: Record<CheckState, Style | null> = {
  success: { label: "Checks passing", Icon: CircleCheck, tone: "text-accent" },
  failure: { label: "Checks failing", Icon: CircleX, tone: "text-danger" },
  error: { label: "Checks error", Icon: TriangleAlert, tone: "text-danger" },
  pending: { label: "Checks pending", Icon: Clock, tone: "text-fg-muted" },
  expected: {
    label: "Checks expected",
    Icon: CircleDashed,
    tone: "text-fg-faint",
  },
  none: null,
};

const REVIEW: Record<ReviewState, Style | null> = {
  approved: { label: "Approved", Icon: CheckCheck, tone: "text-accent" },
  changes_requested: {
    label: "Changes requested",
    Icon: MessageSquareWarning,
    tone: "text-danger",
  },
  review_required: {
    label: "Review required",
    Icon: CircleDashed,
    tone: "text-fg-faint",
  },
  none: null,
};

/**
 * Fixed-width status column: icon only in lists, icon + label in detail.
 * Keeps the right edge of every row aligned regardless of state.
 */
export function StatusIcon({ kind, state, withLabel = false }: StatusProps) {
  const style = kind === "check" ? CHECK[state] : REVIEW[state];
  if (!style) {
    return <span className="flex size-4 shrink-0" aria-hidden />;
  }

  const { Icon, label, tone } = style;
  return (
    <span
      title={label}
      aria-label={label}
      className={`flex shrink-0 items-center gap-2 ${tone}`}
    >
      <Icon className="size-4" aria-hidden />
      {withLabel ? <span className="text-meta">{label}</span> : null}
    </span>
  );
}
