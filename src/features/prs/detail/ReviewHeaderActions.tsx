import { Check, MessageSquare } from "lucide-react";
import { Button } from "../../../components/ui";
import { usePRDetailContext } from "./PRDetailContext";
import { canApprove, canReview } from "./useReview";

/** Compact review controls for the 44px detail bar. */
export function ReviewHeaderActions() {
  const { pr, review } = usePRDetailContext();
  if (!pr || !canReview(pr)) return null;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {pr.viewerReview === "approved" ? (
        <span className="flex items-center gap-1 text-meta text-accent">
          <Check className="size-3.5" aria-hidden />
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
