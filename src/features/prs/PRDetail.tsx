import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { describeError, getConfig, getPR } from "../../lib/api";
import { useLiveRefresh } from "../../lib/liveRefresh";
import { loadDiffForHead } from "../../lib/prRefresh";
import type { ReviewFinding } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { useClaudeAction } from "./action/useClaudeAction";
import { Conversation } from "./detail/Conversation";
import { ContextRail } from "./detail/ContextRail";
import { DetailPanel } from "./detail/DetailPanel";
import { DetailSkeleton } from "./detail/DetailSkeleton";
import { DetailTabs, type DetailTab, type TabDef } from "./detail/DetailTabs";
import { DiffTab } from "./detail/DiffTab";
import { ExplainTab } from "./detail/ExplainTab";
import { PRDetailBar } from "./detail/PRDetailBar";
import { PRDetailContext } from "./detail/PRDetailContext";
import { PRHeader } from "./detail/PRHeader";
import { PRSummary } from "./detail/PRSummary";
import { ReviewPanel } from "./detail/ReviewPanel";
import { PRStateActions, PRStatePanel } from "./detail/PRStateActions";
import { ReviewHeaderActions } from "./detail/ReviewHeaderActions";
import { usePRMutations } from "./detail/usePRMutations";
import { useReview } from "./detail/useReview";
import type { DiffTarget } from "./diff/diffSelection";
import { useDiffComments } from "./diff/useDiffComments";
import { ReviewTab } from "./review/ReviewTab";

type PRDetailProps = {
  repo: string;
  number: number;
};

export function PRDetail({ repo, number }: PRDetailProps) {
  // Remount per PR so action state (stream, artifact, phase) can never leak
  // from one pull request into the next. The query keys already do this for
  // server data; this covers the local run state in useClaudeAction.
  return <PRDetailBody key={`${repo}#${number}`} repo={repo} number={number} />;
}

function PRDetailBody({ repo, number }: PRDetailProps) {
  const closeDetail = useUIStore((state) => state.closeDetail);
  const fullscreen = useUIStore((state) => state.detailFullscreen);
  const toggleFullscreen = useUIStore((state) => state.toggleDetailFullscreen);
  const setDiffMode = useUIStore((state) => state.setDiffMode);
  const prKey = `${repo}#${number}`;
  const [tabState, setTabState] = useState<{
    key: string;
    tab: DetailTab;
  }>({ key: prKey, tab: "conversation" });
  const tab: DetailTab = tabState.key === prKey ? tabState.tab : "conversation";
  const setTab = (next: DetailTab) => setTabState({ key: prKey, tab: next });
  // A finding clicked in the Review tab. The token re-triggers the jump for two
  // findings in the same file; the target is never cleared after consumption.
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  function openInDiff(finding: ReviewFinding) {
    // A finding jump targets one file and line; leave the guided path so the
    // target is always mounted, regardless of which step owns it.
    setDiffMode("files");
    setDiffTarget({
      path: finding.file,
      line: finding.line,
      token: Date.now(),
    });
    setTab("diff");
  }

  const mergePolls = useRef(0);
  // A live re-read must see GitHub's current state, so the next fetch bypasses
  // the server TTLs by reading this flag.
  const liveRefetch = useRef(false);
  const detailQuery = useQuery({
    queryKey: ["pr", repo, number],
    // A poll must bypass the server cache, which may have stored "unknown"
    // right after a draft toggle.
    queryFn: () => {
      const refresh = liveRefetch.current || mergePolls.current > 0;
      liveRefetch.current = false;
      return getPR({ repo, number, refresh });
    },
  });

  // A merged or closed PR is a receipt, not a live document: no poll, no diff
  // and no review actions. Every consumer below keys off this one fact.
  const pr = detailQuery.data?.pr;
  const isOpen = pr?.state === "open";

  // The open PR is what the user is reading, so it is the only detail worth
  // refreshing. The hook pauses on blur and backs off while nothing changes.
  useLiveRefresh(isOpen, detailQuery.data, detailQuery.refetch, () => {
    liveRefetch.current = true;
  });

  const headSHA = pr?.headSHA ?? "";
  const queryClient = useQueryClient();
  const diffQuery = useQuery({
    // A diff only describes one commit. Keying by SHA makes a moved head a
    // different query, so an older diff can never stand in for the new one.
    queryKey: ["pr-diff", repo, number, headSHA],
    // The loader also verifies the response SHA, so a head that moved between
    // the two requests cannot be cached under this key.
    queryFn: () => loadDiffForHead(queryClient, repo, number, headSHA),
    enabled: headSHA !== "" && isOpen,
  });

  const configQuery = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const configuredRepo = configQuery.data?.repos.find(
    (item) => `${item.owner}/${item.name}`.toLowerCase() === repo.toLowerCase(),
  );
  const explainAction = configuredRepo?.actions
    ? (configQuery.data?.actions.find((item) => item.kind === "explain") ??
      null)
    : null;
  const reviewAction = configuredRepo?.actions
    ? (configQuery.data?.actions.find((item) => item.kind === "review") ?? null)
    : null;
  const explain = useClaudeAction(
    repo,
    number,
    explainAction,
    explainAction !== null && isOpen,
  );
  const reviewController = useClaudeAction(
    repo,
    number,
    reviewAction,
    reviewAction !== null && isOpen,
  );
  const review = useReview(repo, number);
  const mutations = usePRMutations(repo, number);
  const diffComments = useDiffComments(repo, number, isOpen && tab === "diff");
  const reviewOpen = review.open;
  const closeReview = review.closePanel;

  // A merged or closed PR has no review controls. Drop a form or confirmation
  // that was up when the state changed, so Escape and the receipt are clean.
  const closeConfirm = mutations.closeConfirm;
  const confirming = mutations.confirming;
  useEffect(() => {
    if (isOpen) return;
    if (reviewOpen) closeReview();
    if (confirming !== null) closeConfirm();
  }, [isOpen, reviewOpen, closeReview, confirming, closeConfirm]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // A line-comment composer closes itself and marks the event handled.
      if (event.defaultPrevented) return;
      event.preventDefault();
      // The merge and close confirmation bars and the review form close first,
      // then fullscreen, then the detail itself.
      if (mutations.confirming !== null) {
        mutations.closeConfirm();
        return;
      }
      if (reviewOpen) {
        closeReview();
        return;
      }
      if (fullscreen) {
        toggleFullscreen();
        return;
      }
      closeDetail();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeDetail,
    mutations,
    reviewOpen,
    closeReview,
    fullscreen,
    toggleFullscreen,
  ]);

  const refetchDetail = detailQuery.refetch;

  // GitHub computes mergeability asynchronously after a draft toggle. Poll a
  // few times, bypassing the cache, so the merge control becomes accurate.
  useEffect(() => {
    if (
      !pr ||
      pr.state !== "open" ||
      (pr.mergeable !== "unknown" && pr.mergeable !== undefined)
    ) {
      mergePolls.current = 0;
      return;
    }
    if (mergePolls.current >= 5) return;
    const timer = window.setTimeout(() => {
      mergePolls.current += 1;
      void refetchDetail();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pr, refetchDetail]);
  const comments = pr?.comments ?? [];
  const explainAvailable = explain.enabled && explain.action !== null;
  const reviewAvailable =
    reviewController.enabled && reviewController.action !== null;
  const requestedTabAvailable =
    (tab !== "explain" || explainAvailable) &&
    (tab !== "review" || reviewAvailable);
  const activeTab: DetailTab = requestedTabAvailable ? tab : "conversation";

  const tabs: TabDef[] = [
    { id: "conversation", label: "Conversation", count: comments.length },
    { id: "diff", label: "Diff", count: pr?.changedFiles },
  ];
  if (reviewAvailable) {
    tabs.push({ id: "review", label: "Review" });
  }
  if (explain.action) {
    tabs.push({ id: "explain", label: explain.action.label });
  }

  // One value for the bar and the body. Stable as long as the PR and the two
  // memoized controllers are, so an unrelated pane render wakes no consumer.
  const detail = useMemo(
    () => (pr ? { pr, mutations, review } : null),
    [pr, mutations, review],
  );

  // Pending and error are the only states without a loaded PR, so one element
  // fills the layout in both the loaded and the loading branch.
  const loadingOrError = detailQuery.isPending ? (
    <DetailSkeleton />
  ) : detailQuery.isError ? (
    <ErrorState
      title="Can’t load this pull request"
      message={describeError(detailQuery.error)}
      retrying={detailQuery.isFetching}
      onRetry={() => void detailQuery.refetch()}
    />
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PRDetailBar
        repo={repo}
        number={number}
        fullscreen={fullscreen}
        onClose={closeDetail}
        onToggleFullscreen={toggleFullscreen}
        url={pr?.url}
      >
        {detail ? (
          <PRDetailContext value={detail}>
            <ReviewHeaderActions />
            <PRStateActions />
          </PRDetailContext>
        ) : null}
      </PRDetailBar>

      {detail ? (
        <PRDetailContext value={detail}>
          {isOpen ? <ReviewPanel /> : null}
          {isOpen ? <PRStatePanel /> : null}

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {loadingOrError ??
                (isOpen ? (
                  <>
                    <PRHeader pr={detail.pr} />
                    <DetailTabs
                      tabs={tabs}
                      active={activeTab}
                      onSelect={setTab}
                    />

                    <DetailPanel activeTab={activeTab}>
                      {activeTab === "conversation" ? (
                        <Conversation pr={detail.pr} comments={comments} />
                      ) : null}

                      {activeTab === "diff" ? (
                        <DiffTab
                          pr={detail.pr}
                          prKey={prKey}
                          diffQuery={diffQuery}
                          comments={diffComments}
                          focusTarget={diffTarget ?? undefined}
                        />
                      ) : null}

                      {activeTab === "review" ? (
                        <ReviewTab
                          repo={repo}
                          number={number}
                          controller={reviewController}
                          reviewAvailable={
                            configuredRepo?.review.available ?? false
                          }
                          unavailableReason={configuredRepo?.review.reason}
                          configPath={configQuery.data?.configPath}
                          diffFiles={diffQuery.data?.files}
                          onOpenInDiff={openInDiff}
                        />
                      ) : null}

                      {activeTab === "explain" ? (
                        <ExplainTab controller={explain} />
                      ) : null}
                    </DetailPanel>
                  </>
                ) : (
                  <PRSummary pr={detail.pr} />
                ))}
            </div>

            {isOpen && activeTab !== "diff" ? (
              <ContextRail diff={diffQuery.data} />
            ) : null}
          </div>
        </PRDetailContext>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{loadingOrError}</div>
        </div>
      )}
    </div>
  );
}
