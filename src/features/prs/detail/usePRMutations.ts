import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
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

  const error = draftMutation.isError
    ? describeError(draftMutation.error)
    : mergeMutation.isError
      ? describeError(mergeMutation.error)
      : closeMutation.isError
        ? describeError(closeMutation.error)
        : null;

  return {
    pending:
      draftMutation.isPending ||
      mergeMutation.isPending ||
      closeMutation.isPending,
    submitting: draftMutation.isPending
      ? "draft"
      : mergeMutation.isPending
        ? "merge"
        : closeMutation.isPending
          ? "close"
          : null,
    error,
    confirming,
    openMergeConfirm: () => {
      draftMutation.reset();
      mergeMutation.reset();
      closeMutation.reset();
      setConfirming("merge");
    },
    openCloseConfirm: () => {
      draftMutation.reset();
      mergeMutation.reset();
      closeMutation.reset();
      setConfirming("close");
    },
    closeConfirm,
    toggleDraft: (draft) => {
      mergeMutation.reset();
      closeMutation.reset();
      draftMutation.reset();
      draftMutation.mutate(draft);
    },
    merge: (sha) => mergeMutation.mutate(sha),
    close: () => closeMutation.mutate(),
  };
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
