import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { describeError, getConfig, getPR } from "../../lib/api";
import { useLiveRefresh } from "../../lib/liveRefresh";
import { loadDiffForHead } from "../../lib/prRefresh";
import type { ReviewFinding } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { useClaudeAction } from "./action/useClaudeAction";
import { Conversation } from "./detail/Conversation";
import { ContextRail } from "./detail/ContextRail";
import { DetailSkeleton } from "./detail/DetailSkeleton";
import { DetailTabs, type DetailTab, type TabDef } from "./detail/DetailTabs";
import { DiffTab } from "./detail/DiffTab";
import { ExplainTab } from "./detail/ExplainTab";
import { PRDetailBar } from "./detail/PRDetailBar";
import { PRHeader } from "./detail/PRHeader";
import { ReviewPanel } from "./detail/ReviewPanel";
import { PRStatePanel } from "./detail/PRStateActions";
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

  // The open PR is what the user is reading, so it is the only detail worth
  // refreshing. The hook pauses on blur and backs off while nothing changes.
  useLiveRefresh(true, detailQuery.data, detailQuery.refetch, () => {
    liveRefetch.current = true;
  });

  const headSHA = detailQuery.data?.pr.headSHA ?? "";
  const queryClient = useQueryClient();
  const diffQuery = useQuery({
    // A diff only describes one commit. Keying by SHA makes a moved head a
    // different query, so an older diff can never stand in for the new one.
    queryKey: ["pr-diff", repo, number, headSHA],
    // The loader also verifies the response SHA, so a head that moved between
    // the two requests cannot be cached under this key.
    queryFn: () => loadDiffForHead(queryClient, repo, number, headSHA),
    enabled: headSHA !== "",
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
    explainAction !== null,
  );
  const reviewController = useClaudeAction(
    repo,
    number,
    reviewAction,
    reviewAction !== null,
  );
  const review = useReview(repo, number);
  const mutations = usePRMutations(repo, number);
  const diffComments = useDiffComments(repo, number, tab === "diff");
  const reviewOpen = review.open;
  const closeReview = review.closePanel;

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

  const pr = detailQuery.data?.pr;
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PRDetailBar
        repo={repo}
        number={number}
        pr={pr}
        review={review}
        mutations={mutations}
        fullscreen={fullscreen}
        onClose={closeDetail}
        onToggleFullscreen={toggleFullscreen}
      />

      <ReviewPanel review={review} />
      {pr ? <PRStatePanel pr={pr} mutations={mutations} /> : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {detailQuery.isPending ? (
            <DetailSkeleton />
          ) : detailQuery.isError ? (
            <div
              role="alert"
              className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"
            >
              <p className="text-ui text-fg">Can’t load this pull request</p>
              <p className="max-w-sm text-meta text-fg-faint">
                {describeError(detailQuery.error)}
              </p>
              <Button
                variant="outline"
                onClick={() => void detailQuery.refetch()}
                disabled={detailQuery.isFetching}
                className="mt-1"
              >
                {detailQuery.isFetching ? "Retrying…" : "Retry"}
              </Button>
            </div>
          ) : pr ? (
            <>
              <PRHeader pr={pr} />
              <DetailTabs tabs={tabs} active={activeTab} onSelect={setTab} />

              <div
                role="tabpanel"
                id={`detail-panel-${activeTab}`}
                aria-labelledby={`detail-tab-${activeTab}`}
                tabIndex={0}
                className={
                  activeTab === "diff"
                    ? "flex min-h-0 flex-1 flex-col outline-none"
                    : "min-h-0 flex-1 overflow-y-auto p-4 outline-none"
                }
              >
                {activeTab === "conversation" ? (
                  <Conversation pr={pr} comments={comments} />
                ) : null}

                {activeTab === "diff" ? (
                  <DiffTab
                    pr={pr}
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
                    reviewAvailable={configuredRepo?.review.available ?? false}
                    unavailableReason={configuredRepo?.review.reason}
                    configPath={configQuery.data?.configPath}
                    diffFiles={diffQuery.data?.files}
                    onOpenInDiff={openInDiff}
                  />
                ) : null}

                {activeTab === "explain" ? (
                  <ExplainTab controller={explain} />
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {pr && activeTab !== "diff" ? (
          <ContextRail pr={pr} diff={diffQuery.data} />
        ) : null}
      </div>
    </div>
  );
}
