import { Button } from "../../../components/ui";
import { usePRDetailContext } from "./PRDetailContext";

/** One review form: request changes, or comment without a verdict. */
export function ReviewPanel() {
  const { review } = usePRDetailContext();
  if (!review.open) {
    // An approval can fail with the panel shut; the error still has to show.
    return review.error ? (
      <div
        role="alert"
        className="shrink-0 border-b border-line px-4 py-2 text-meta text-danger"
      >
        {review.error}
      </div>
    ) : null;
  }

  const hasComment = review.comment.trim() !== "";

  return (
    <section
      id="review-panel"
      aria-label="Write a review"
      className="shrink-0 border-b border-line px-4 py-3"
    >
      <label htmlFor="review-comment" className="sr-only">
        Review comment
      </label>
      <textarea
        id="review-comment"
        value={review.comment}
        onChange={(event) => review.setComment(event.target.value)}
        rows={3}
        autoFocus
        placeholder="Leave a comment…"
        className="w-full resize-y rounded-sm border border-line bg-surface p-2 text-prose text-fg placeholder:text-fg-faint"
      />

      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="primary"
          onClick={() => review.submit("REQUEST_CHANGES")}
          disabled={review.pending || !hasComment}
          title="Submit a review that blocks merging until addressed"
        >
          {review.submitting === "REQUEST_CHANGES"
            ? "Submitting…"
            : "Request changes"}
        </Button>
        <Button
          variant="outline"
          onClick={() => review.submit("COMMENT")}
          disabled={review.pending || !hasComment}
        >
          {review.submitting === "COMMENT" ? "Submitting…" : "Comment"}
        </Button>
        <Button
          variant="ghost"
          onClick={review.closePanel}
          disabled={review.pending}
          className="ml-auto"
        >
          Cancel
        </Button>
      </div>

      {review.error ? (
        <p role="alert" className="mt-2 text-meta text-danger">
          {review.error}
        </p>
      ) : null}
    </section>
  );
}
