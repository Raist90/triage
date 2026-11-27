import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../../components/ui";
import {
  describeError,
  discardReviewDraft,
  publishReviewDraft,
} from "../../../lib/api";
import type { ReviewFinding } from "../../../lib/types";

/**
 * Publishes the review's findings into one pending review on GitHub. Nothing is
 * public until the review is submitted, and an existing draft is replaced only
 * when the user says so. Praise stays in Triage: it has no action for the
 * author.
 */
export function PublishDraft({
  repo,
  number,
  actionID,
  findings,
  pending,
}: {
  repo: string;
  number: number;
  actionID: string;
  findings: ReviewFinding[];
  /** True when GitHub holds an unsubmitted review from the viewer. */
  pending: boolean;
}) {
  const queryClient = useQueryClient();
  const publishable = findings.filter(
    (finding) => finding.severity !== "praise",
  ).length;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["pr", repo, number] });
    void queryClient.invalidateQueries({
      queryKey: ["pr-comments", repo, number],
    });
  };

  const publish = useMutation({
    mutationFn: async (replace: boolean) => {
      if (replace) await discardReviewDraft({ repo, number });
      return publishReviewDraft({ repo, number, actionID });
    },
    onSuccess: invalidate,
  });

  const discard = useMutation({
    mutationFn: () => discardReviewDraft({ repo, number }),
    onSuccess: invalidate,
  });

  if (publishable === 0) return null;

  const busy = publish.isPending || discard.isPending;
  const failure = publish.error ?? discard.error;

  return (
    <div className="mt-2 flex flex-col gap-1">
      {pending ? (
        <>
          <p className="text-micro leading-4 text-fg-faint">
            A draft review on GitHub already carries these findings.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => publish.mutate(true)}
            >
              {publish.isPending
                ? "Publishing…"
                : `Replace draft (${publishable})`}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => discard.mutate()}
            >
              {discard.isPending ? "Discarding…" : "Discard draft"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => publish.mutate(false)}
          >
            {publish.isPending
              ? "Publishing…"
              : `Publish ${publishable} finding${publishable === 1 ? "" : "s"}`}
          </Button>
          <p className="text-micro leading-4 text-fg-faint">
            Adds one inline comment per finding to a draft review on GitHub.
            Nothing is public until you submit it.
          </p>
        </>
      )}

      {failure ? (
        <p role="alert" className="text-meta text-danger">
          {describeError(failure)}
        </p>
      ) : null}
    </div>
  );
}
