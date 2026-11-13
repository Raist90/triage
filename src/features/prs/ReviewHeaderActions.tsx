import { Check, MessageSquare } from "lucide-react";
import { Button } from "../../components/ui";
import type { PR } from "../../lib/types";
import { canApprove, canReview, type ReviewController } from "./useReview";

type ReviewHeaderActionsProps = {
  pr: PR;
  review: ReviewController;
};

/** Compact review controls for the 44px detail bar. */
export function ReviewHeaderActions({ pr, review }: ReviewHeaderActionsProps) {
  if (!canReview(pr)) return null;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {pr.viewerReview === "approved" ? (
        <span className="flex items-center gap-1 text-micro font-medium tracking-[0.08em] text-accent uppercase">
          <Check className="size-3" aria-hidden />
          Approved
        </span>
      ) : canApprove(pr) ? (
        <Button
          variant="primary"
          onClick={() => review.submit("APPROVE", "")}
          disabled={review.pending}
          title="Approve this pull request"
        >
          <Check className="size-4" aria-hidden />
          {review.submitting === "APPROVE" ? "Approving…" : "Approve"}
        </Button>
      ) : null}

      <Button
        variant="outline"
        onClick={review.togglePanel}
        aria-expanded={review.open}
        aria-controls="review-panel"
        disabled={review.pending}
        title="Request changes or leave a review comment"
      >
        <MessageSquare className="size-4" aria-hidden />
        Review
      </Button>
    </div>
  );
}
