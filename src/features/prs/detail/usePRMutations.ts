import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closePR, describeError, mergePR, setPRDraft } from "../../../lib/api";

/** GitHub's search index lags a merge, close or draft change by a moment. */
const LIST_REFRESH_DELAY_MS = 1500;

export type PRStateAction = "draft" | "merge" | "close";

export type PRMutationController = {
  pending: boolean;
  /** Action currently in flight, so only that control reads as busy. */
  submitting: PRStateAction | null;
  error: string | null;
  /** Which confirmation bar is open, or null when none is. */
  confirming: "merge" | "close" | null;
  openMergeConfirm: () => void;
  openCloseConfirm: () => void;
  closeConfirm: () => void;
  toggleDraft: (draft: boolean) => void;
  merge: (sha: string) => void;
  close: () => void;
};

/**
 * Draft, merge and close mutations are server truth. The detail refreshes at
 * once; the list waits for GitHub's search index, then invalidates every list
 * query.
 */
export function usePRMutations(
  repo: string,
  number: number,
): PRMutationController {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<"merge" | "close" | null>(null);
  const listTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (listTimer.current !== null) window.clearTimeout(listTimer.current);
    };
  }, []);

  const refreshDetail = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["pr", repo, number] });
  }, [queryClient, repo, number]);

  const closeConfirm = useCallback(() => setConfirming(null), []);

  const scheduleListRefresh = useCallback(() => {
    if (listTimer.current !== null) window.clearTimeout(listTimer.current);
    listTimer.current = window.setTimeout(() => {
      listTimer.current = null;
      void queryClient.invalidateQueries({ queryKey: ["prs"] });
    }, LIST_REFRESH_DELAY_MS);
  }, [queryClient]);

  const draftMutation = useMutation({
    mutationFn: (draft: boolean) => setPRDraft({ repo, number, draft }),
    onSuccess: () => {
      refreshDetail();
      scheduleListRefresh();
    },
    onError: refreshDetail,
  });

  const mergeMutation = useMutation({
    mutationFn: (sha: string) => mergePR({ repo, number, sha }),
    onSuccess: () => {
      setConfirming(null);
      // The detail refetches to the merged receipt and stays open; the list
      // drops the PR once GitHub's search index catches up.
      refreshDetail();
      scheduleListRefresh();
    },
    // A rejected merge can mean the head moved. Refresh so the next attempt
    // pins the new SHA instead of repeating the same conflict.
    onError: refreshDetail,
  });

  const closeMutation = useMutation({
    mutationFn: () => closePR({ repo, number }),
    onSuccess: () => {
      setConfirming(null);
      refreshDetail();
      scheduleListRefresh();
    },
    // A rejected close leaves the confirmation bar open with the reason, so
    // the user can retry or cancel.
    onError: refreshDetail,
  });

  // Destructured so the callbacks depend on the stable mutation functions,
  // not on the result objects TanStack rebuilds every render.
  const { reset: resetDraft, mutate: mutateDraft } = draftMutation;
  const { reset: resetMerge, mutate: mutateMerge } = mergeMutation;
  const { reset: resetClose, mutate: mutateClose } = closeMutation;

  const openMergeConfirm = useCallback(() => {
    resetDraft();
    resetMerge();
    resetClose();
    setConfirming("merge");
  }, [resetDraft, resetMerge, resetClose]);

  const openCloseConfirm = useCallback(() => {
    resetDraft();
    resetMerge();
    resetClose();
    setConfirming("close");
  }, [resetDraft, resetMerge, resetClose]);

  const toggleDraft = useCallback(
    (draft: boolean) => {
      resetMerge();
      resetClose();
      resetDraft();
      mutateDraft(draft);
    },
    [resetDraft, resetMerge, resetClose, mutateDraft],
  );

  const merge = useCallback((sha: string) => mutateMerge(sha), [mutateMerge]);
  const close = useCallback(() => mutateClose(), [mutateClose]);

  const error = draftMutation.isError
    ? describeError(draftMutation.error)
    : mergeMutation.isError
      ? describeError(mergeMutation.error)
      : closeMutation.isError
        ? describeError(closeMutation.error)
        : null;
  const pending =
    draftMutation.isPending ||
    mergeMutation.isPending ||
    closeMutation.isPending;
  const submitting = draftMutation.isPending
    ? "draft"
    : mergeMutation.isPending
      ? "merge"
      : closeMutation.isPending
        ? "close"
        : null;

  // A stable controller keeps the detail context from waking its consumers
  // when an unrelated pane render asks for the same mutation state again.
  return useMemo(
    () => ({
      pending,
      submitting,
      error,
      confirming,
      openMergeConfirm,
      openCloseConfirm,
      closeConfirm,
      toggleDraft,
      merge,
      close,
    }),
    [
      pending,
      submitting,
      error,
      confirming,
      openMergeConfirm,
      openCloseConfirm,
      closeConfirm,
      toggleDraft,
      merge,
      close,
    ],
  );
}

/** Only your own open PR can be drafted, merged or closed from Triage. */
export function canManagePR(pr: {
  state: string;
  author: string;
  viewerLogin?: string;
}): boolean {
  return (
    pr.state === "open" &&
    pr.viewerLogin !== undefined &&
    pr.viewerLogin.toLowerCase() === pr.author.toLowerCase()
  );
}

export type MergeBlocker =
  "disabled" | "draft" | "conflict" | "blocked" | "unknown" | null;

/** Why the merge control is unavailable, or null when GitHub should decide. */
export function mergeBlocker(pr: {
  isDraft: boolean;
  mergeable?: string;
  mergeStateStatus?: string;
  squashMergeAllowed?: boolean;
}): MergeBlocker {
  if (pr.squashMergeAllowed === false) return "disabled";
  if (pr.isDraft) return "draft";
  if (pr.mergeable === "conflicting") return "conflict";
  if (pr.mergeable !== "mergeable") return "unknown";
  if (pr.mergeStateStatus === "blocked" || pr.mergeStateStatus === "dirty") {
    return "blocked";
  }
  return null;
}
