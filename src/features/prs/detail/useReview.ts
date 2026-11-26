import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { describeError, submitReview } from "../../../lib/api";
import type { PR, ReviewEvent } from "../../../lib/types";

export type ReviewController = {
  pending: boolean;
  /** Event currently in flight, so only that button reads as busy. */
  submitting: ReviewEvent | null;
  error: string | null;
  open: boolean;
  togglePanel: () => void;
  openPanel: () => void;
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
  const openPanel = useCallback(() => setOpen(true), []);
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

  // Destructured so `submit` depends on the stable function, not on the
  // result object that TanStack rebuilds every render.
  const { mutate } = mutation;
  const submit = useCallback(
    (event: ReviewEvent, body?: string) => {
      mutate({ event, body: body ?? comment });
    },
    [mutate, comment],
  );

  // A stable controller keeps the detail context from waking its consumers
  // when an unrelated pane render asks for the same review state again.
  const { isPending, isError, error, variables } = mutation;
  return useMemo(
    () => ({
      pending: isPending,
      submitting: isPending ? (variables?.event ?? null) : null,
      error: isError ? describeError(error) : null,
      open,
      togglePanel,
      openPanel,
      closePanel,
      comment,
      setComment,
      submit,
    }),
    [
      isPending,
      isError,
      error,
      variables,
      open,
      togglePanel,
      openPanel,
      closePanel,
      comment,
      submit,
    ],
  );
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
