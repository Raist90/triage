import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, mergePR, setPRDraft } from "../../lib/api";

/** GitHub's search index lags a merge or draft change by a moment. */
const LIST_REFRESH_DELAY_MS = 1500;

export type PRMutationController = {
  pending: boolean;
  /** Action currently in flight, so only that control reads as busy. */
  submitting: "draft" | "merge" | null;
  error: string | null;
  confirmOpen: boolean;
  openConfirm: () => void;
  closeConfirm: () => void;
  toggleDraft: (draft: boolean) => void;
  merge: (sha: string) => void;
};

/**
 * Draft and merge mutations are server truth. The detail refreshes at once;
 * the list waits for GitHub's search index, then invalidates every list query.
 */
export function usePRMutations(
  repo: string,
  number: number,
): PRMutationController {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const listTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (listTimer.current !== null) window.clearTimeout(listTimer.current);
    };
  }, []);

  const refreshDetail = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["pr", repo, number] });
  }, [queryClient, repo, number]);

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
      setConfirmOpen(false);
      refreshDetail();
      scheduleListRefresh();
    },
    // A rejected merge can mean the head moved. Refresh so the next attempt
    // pins the new SHA instead of repeating the same conflict.
    onError: refreshDetail,
  });

  const error = draftMutation.isError
    ? describeError(draftMutation.error)
    : mergeMutation.isError
      ? describeError(mergeMutation.error)
      : null;

  return {
    pending: draftMutation.isPending || mergeMutation.isPending,
    submitting: draftMutation.isPending
      ? "draft"
      : mergeMutation.isPending
        ? "merge"
        : null,
    error,
    confirmOpen,
    openConfirm: () => {
      draftMutation.reset();
      mergeMutation.reset();
      setConfirmOpen(true);
    },
    closeConfirm: () => setConfirmOpen(false),
    toggleDraft: (draft) => {
      mergeMutation.reset();
      draftMutation.reset();
      draftMutation.mutate(draft);
    },
    merge: (sha) => mergeMutation.mutate(sha),
  };
}

/** Only your own open PR can be converted to a draft or merged from Triage. */
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
