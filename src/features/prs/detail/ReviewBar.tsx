import { Play, RefreshCw, X } from "lucide-react";
import { Button } from "../../../components/ui";
import { cx } from "../../../lib/cx";
import type { InlineComment, PR, ReviewFinding } from "../../../lib/types";
import type { ClaudeActionController } from "../action/useClaudeAction";
import { ConversationSection } from "./ConversationSection";
import { ExplainSection } from "./ExplainSection";
import { ReviewPanel } from "./ReviewPanel";
import { ReviewSection } from "./ReviewSection";

/**
 * The fixed 300px column: review state and index, conversation, explanation,
 * and one primary action. Review submission mounts above the scroll so it can
 * never be lost to the scroll position.
 */
export function ReviewBar({
  pr,
  review,
  explain,
  reviewAvailable,
  reviewConfigured,
  stale,
  unavailableReason,
  configPath,
  onFocusFinding,
  inlineComments,
  onFocusComment,
  open,
}: {
  pr: PR;
  review: ClaudeActionController;
  explain: ClaudeActionController;
  /** False when no review action is configured; disables the footer. */
  reviewAvailable: boolean;
  /** True when the repository can run a review at all (it has a clone). */
  reviewConfigured: boolean;
  stale: boolean;
  unavailableReason?: string;
  configPath?: string;
  onFocusFinding: (finding: ReviewFinding) => void;
  /** Submitted and pending review comments, newest source of truth. */
  inlineComments: InlineComment[];
  onFocusComment: (comment: InlineComment) => void;
  /** Below the wide breakpoint: hidden unless the detail bar toggled it. */
  open: boolean;
}) {
  const comments = pr.comments ?? [];
  const { artifact, error, running } = review;

  let primary;
  if (running) {
    primary = (
      <Button variant="outline" onClick={review.cancel} className="w-full">
        <X className="size-3.5 animate-pulse" aria-hidden />
        Cancel
      </Button>
    );
  } else if (error) {
    primary = (
      <Button
        variant="primary"
        onClick={review.run}
        disabled={!reviewAvailable}
        className="w-full"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Retry review
      </Button>
    );
  } else if (artifact) {
    primary = (
      <Button
        variant="primary"
        onClick={review.run}
        disabled={!reviewAvailable}
        className="w-full"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        Re-run review
      </Button>
    );
  } else {
    primary = (
      <Button
        variant="primary"
        onClick={review.run}
        disabled={!reviewAvailable}
        title={
          reviewAvailable
            ? "Run the automatic review"
            : "Automatic review is not configured"
        }
        className="w-full"
      >
        <Play className="size-3.5" aria-hidden />
        Start review
      </Button>
    );
  }

  return (
    <aside
      aria-label="Review bar"
      className={cx(
        "min-h-0 flex-col border-line bg-canvas/95 wide:border-l",
        open ? "flex" : "hidden wide:flex",
      )}
    >
      <ReviewPanel />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        <ReviewSection
          pr={pr}
          controller={review}
          reviewAvailable={reviewConfigured}
          stale={stale}
          unavailableReason={unavailableReason}
          configPath={configPath}
          onFocusFinding={onFocusFinding}
        />
        <div className="mt-3 border-t border-line" />
        <div className="mt-3">
          <ConversationSection
            comments={comments}
            inline={inlineComments}
            onFocusComment={onFocusComment}
          />
        </div>
        {explain.action ? (
          <>
            <div className="mt-3 border-t border-line" />
            <div className="mt-3">
              <ExplainSection controller={explain} />
            </div>
          </>
        ) : null}
      </div>
      <div className="flex h-11 shrink-0 items-center border-t border-line px-4">
        {primary}
      </div>
    </aside>
  );
}
