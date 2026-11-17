import type { QueryClient } from "@tanstack/react-query";
import { getPR, getPRDiff } from "./api";
import type { PR, PRDetailResponse, PRDiffResponse } from "./types";

/** A diff response described a commit other than the one requested. */
export class HeadMovedError extends Error {
  constructor() {
    super("The pull request moved while loading its diff.");
    this.name = "HeadMovedError";
  }
}

/**
 * Loads the diff for one expected head. A response for another commit is filed
 * under its own key and the detail is re-read, so a diff is never cached under
 * a commit it does not describe.
 */
export async function loadDiffForHead(
  queryClient: QueryClient,
  repo: string,
  number: number,
  headSHA: string,
  refresh = false,
): Promise<PRDiffResponse> {
  const diff = await getPRDiff({ repo, number, refresh });
  if (diff.headSHA === headSHA) return diff;
  if (diff.headSHA !== "") {
    queryClient.setQueryData(["pr-diff", repo, number, diff.headSHA], diff);
  }
  void queryClient.invalidateQueries({ queryKey: ["pr", repo, number] });
  throw new HeadMovedError();
}

/**
 * Re-reads an open PR above the server TTLs after a manual list refresh. The
 * list is already fresh; its head may have moved, so detail and diff must not
 * keep answering for the previous commit.
 */
export async function refreshOpenPR(
  queryClient: QueryClient,
  repo: string,
  number: number,
): Promise<void> {
  const detail = await queryClient.fetchQuery({
    queryKey: ["pr", repo, number],
    queryFn: () => getPR({ repo, number, refresh: true }),
    staleTime: 0,
  });
  const sha = detail.pr.headSHA;
  if (sha === "") return;
  try {
    await queryClient.fetchQuery({
      queryKey: ["pr-diff", repo, number, sha],
      queryFn: () => loadDiffForHead(queryClient, repo, number, sha, true),
      staleTime: 0,
    });
  } catch (error) {
    // The guard already refreshed the detail; the new head's query loads next.
    if (!(error instanceof HeadMovedError)) throw error;
  }
}

/**
 * Opening a PR must not show the commit a fresh list already replaced. A
 * cached detail whose head differs from the list row is stale, so re-read it
 * above the server cache. A missing detail loads through the normal query.
 */
export async function syncPRHead(
  queryClient: QueryClient,
  pr: PR,
): Promise<void> {
  const cached = queryClient.getQueryData<PRDetailResponse>([
    "pr",
    pr.repo,
    pr.number,
  ]);
  if (!cached || cached.pr.headSHA === pr.headSHA) return;
  await queryClient.fetchQuery({
    queryKey: ["pr", pr.repo, pr.number],
    queryFn: () => getPR({ repo: pr.repo, number: pr.number, refresh: true }),
    staleTime: 0,
  });
}
