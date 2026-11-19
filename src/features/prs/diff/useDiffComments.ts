import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  deletePRComment,
  describeError,
  getPRComments,
  submitPRComment,
  type SubmitCommentOptions,
} from "../../../lib/api";
import type { InlineComment } from "../../../lib/types";

type NewComment = Omit<SubmitCommentOptions, "repo" | "number">;

const EMPTY_COMMENTS: InlineComment[] = [];

export type DiffCommentsController = {
  comments: InlineComment[];
  pending: boolean;
  /** Comment currently being deleted, if any. */
  deletingID: number | null;
  /** Resolves null on success, otherwise the error message. */
  submit: (input: NewComment) => Promise<string | null>;
  remove: (commentID: number) => Promise<string | null>;
};

/** Inline comments are server truth: nothing is duplicated into a store. */
export function useDiffComments(
  repo: string,
  number: number,
  enabled: boolean,
): DiffCommentsController {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pr-comments", repo, number],
    queryFn: () => getPRComments({ repo, number }),
    enabled,
  });

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ["pr-comments", repo, number],
    });
    void queryClient.invalidateQueries({ queryKey: ["pr", repo, number] });
    void queryClient.invalidateQueries({ queryKey: ["prs"] });
  }

  const mutation = useMutation({
    mutationFn: (input: NewComment) =>
      submitPRComment({ repo, number, ...input }),
    onSuccess: refresh,
  });

  const deleteMutation = useMutation({
    mutationFn: (commentID: number) =>
      deletePRComment({ repo, number, commentID }),
    onSuccess: refresh,
  });

  // Destructured so the callbacks depend on the stable function itself rather
  // than on the mutation result object, which is rebuilt every render.
  const { mutateAsync: submitComment } = mutation;
  const { mutateAsync: deleteComment } = deleteMutation;

  const submit = useCallback(
    async (input: NewComment) => {
      try {
        await submitComment(input);
        return null;
      } catch (error) {
        return describeError(error);
      }
    },
    [submitComment],
  );

  const remove = useCallback(
    async (commentID: number) => {
      try {
        await deleteComment(commentID);
        return null;
      } catch (error) {
        return describeError(error);
      }
    },
    [deleteComment],
  );

  // A stable controller keeps the memoized diff sections from re-rendering
  // when an unrelated parent render asks for the same data again.
  const comments = query.data?.comments ?? EMPTY_COMMENTS;
  const deletingID = deleteMutation.isPending
    ? (deleteMutation.variables ?? null)
    : null;
  return useMemo(
    () => ({
      comments,
      pending: mutation.isPending,
      deletingID,
      submit,
      remove,
    }),
    [comments, mutation.isPending, deletingID, submit, remove],
  );
}
