import type { QueryClient } from "@tanstack/react-query";
import { getPR, getPRDiff } from "./api";
import type { PR, PRDetailResponse } from "./types";

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
  await queryClient.fetchQuery({
    queryKey: ["pr-diff", repo, number, sha],
    queryFn: () => getPRDiff({ repo, number, refresh: true }),
    staleTime: 0,
  });
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
