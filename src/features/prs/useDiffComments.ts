import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deletePRComment,
  describeError,
  getPRComments,
  submitPRComment,
  type SubmitCommentOptions,
} from "../../lib/api";
import type { InlineComment } from "../../lib/types";

type NewComment = Omit<SubmitCommentOptions, "repo" | "number">;

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

  return {
    comments: query.data?.comments ?? [],
    pending: mutation.isPending,
    deletingID: deleteMutation.isPending
      ? (deleteMutation.variables ?? null)
      : null,
    submit: async (input) => {
      try {
        await mutation.mutateAsync(input);
        return null;
      } catch (error) {
        return describeError(error);
      }
    },
    remove: async (commentID) => {
      try {
        await deleteMutation.mutateAsync(commentID);
        return null;
      } catch (error) {
        return describeError(error);
      }
    },
  };
}
