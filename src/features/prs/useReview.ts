import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { describeError, submitReview } from "../../lib/api";
import type { PR, ReviewEvent } from "../../lib/types";

export type ReviewController = {
  pending: boolean;
  /** Event currently in flight, so only that button reads as busy. */
  submitting: ReviewEvent | null;
  error: string | null;
  open: boolean;
  togglePanel: () => void;
  closePanel: () => void;
  comment: string;
  setComment: (value: string) => void;
  /** Defaults to the panel draft; the header approve passes an empty body. */
  submit: (event: ReviewEvent, body?: string) => void;
};

/** Review state is server truth: nothing is written to a store, the PR query
 * and every list tab are invalidated after a submission. */
export function useReview(repo: string, number: number): ReviewController {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");

  const togglePanel = useCallback(() => setOpen((value) => !value), []);
  const closePanel = useCallback(() => setOpen(false), []);

  const mutation = useMutation({
    mutationFn: ({ event, body }: { event: ReviewEvent; body?: string }) =>
      submitReview({ repo, number, event, body }),
    onSuccess: () => {
      setComment("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["pr", repo, number] });
      void queryClient.invalidateQueries({ queryKey: ["prs"] });
    },
  });

  return {
    pending: mutation.isPending,
    submitting: mutation.isPending ? (mutation.variables?.event ?? null) : null,
    error: mutation.isError ? describeError(mutation.error) : null,
    open,
    togglePanel,
    closePanel,
    comment,
    setComment,
    submit: (event, body = comment) => mutation.mutate({ event, body }),
  };
}

/** Only open, non-draft PRs accept a review, and GitHub rejects self-approval. */
export function canReview(pr: PR): boolean {
  return pr.state === "open" && !pr.isDraft;
}

export function canApprove(pr: PR): boolean {
  return (
    canReview(pr) &&
    pr.viewerCanApprove === true &&
    pr.viewerReview !== "approved"
  );
}
