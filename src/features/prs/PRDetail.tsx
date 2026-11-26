import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { StateView } from "../../components/StateView";
import { describeError, getConfig, getPR } from "../../lib/api";
import { useLiveRefresh } from "../../lib/liveRefresh";
import { loadDiffForHead } from "../../lib/prRefresh";
import { formatRelative } from "../../lib/time";
import type { ReviewFinding } from "../../lib/types";
import { useUIStore, type DetailView } from "../../stores/ui";
import { useClaudeAction } from "./action/useClaudeAction";
import { Briefing } from "./detail/Briefing";
import { Conversation } from "./detail/Conversation";
import { DetailSkeleton } from "./detail/DetailSkeleton";
import { DiffTab } from "./detail/DiffTab";
import { ExplainPlace } from "./detail/ExplainPlace";
import { PlaceBar } from "./detail/PlaceBar";
import { PlaceShell } from "./detail/PlaceShell";
import { PRDetailBar } from "./detail/PRDetailBar";
import { PRDetailContext } from "./detail/PRDetailContext";
import { PRStatePanel } from "./detail/PRStatePanel";
import { PRSummary } from "./detail/PRSummary";
import { ReviewPanel } from "./detail/ReviewPanel";
import { usePRMutations } from "./detail/usePRMutations";
import { useReview } from "./detail/useReview";
import type { DiffTarget } from "./diff/diffSelection";
import { useDiffComments } from "./diff/useDiffComments";
import { ReviewTab } from "./review/ReviewTab";

type PRDetailProps = {
  repo: string;
  number: number;
  /** The list tab this PR was opened from; drives the briefing Why label. */
  tabID?: string;
};

export function PRDetail({ repo, number, tabID = "all" }: PRDetailProps) {
  // Remount per PR so action state (stream, artifact, phase) can never leak
  // from one pull request into the next. The query keys already do this for
  // server data; this covers the local run state in useClaudeAction.
  return (
    <PRDetailBody
      key={`${repo}#${number}`}
      repo={repo}
      number={number}
      tabID={tabID}
    />
  );
}

function PRDetailBody({ repo, number, tabID = "all" }: PRDetailProps) {
  const closeDetail = useUIStore((state) => state.closeDetail);
  const fullscreen = useUIStore((state) => state.detailFullscreen);
  const toggleFullscreen = useUIStore((state) => state.toggleDetailFullscreen);
  const setDiffMode = useUIStore((state) => state.setDiffMode);
  const prKey = `${repo}#${number}`;
  const [viewState, setViewState] = useState<{
    key: string;
    view: DetailView;
    /** Intent token already applied, so a render-time adjust happens once. */
    appliedToken?: number;
  }>({ key: prKey, view: "briefing" });
  const setView = (next: DetailView) =>
    setViewState({
      key: prKey,
      view: next,
      appliedToken: viewState.appliedToken,
    });
  // A finding clicked in the Review place. The token re-triggers the jump for
  // two findings in the same file; the target is never cleared after use.
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);

  function openInDiff(finding: ReviewFinding) {
    // A finding jump targets one file and line; leave the guided path so the
    // target is always mounted, regardless of which step owns it.
    openDiffAt(finding.file, finding.line);
  }

  function openDiffAt(path: string, line?: number) {
    setDiffMode("files");
    setDiffTarget({ path, line, token: Date.now() });
    setView("diff");
  }

  // A hero action opens a specific place. Apply it during render (the React
  // "adjust state when props change" pattern), then clear the store intent in
  // an effect so a refetch or remount cannot replay the jump.
  const detailIntent = useUIStore((state) => state.detailIntent);
  const clearDetailIntent = useUIStore((state) => state.clearDetailIntent);
  const pendingIntent =
    detailIntent &&
    detailIntent.prKey === prKey &&
    detailIntent.token !== viewState.appliedToken
      ? detailIntent
      : null;
  if (pendingIntent) {
    setViewState({
      key: prKey,
      view: pendingIntent.view,
      appliedToken: pendingIntent.token,
    });
    if (pendingIntent.view === "diff") {
      setDiffMode("files");
      setDiffTarget(
        pendingIntent.diffTarget
          ? { ...pendingIntent.diffTarget, token: pendingIntent.token }
          : null,
      );
    } else {
      setDiffTarget(null);
    }
  }
  useEffect(() => {
    if (detailIntent && detailIntent.prKey === prKey) clearDetailIntent();
  }, [detailIntent, prKey, clearDetailIntent]);

  const requestedView: DetailView =
    viewState.key === prKey ? viewState.view : "briefing";
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

  const explainAvailable = explain.enabled && explain.action !== null;
  const reviewAvailable =
    reviewController.enabled && reviewController.action !== null;
  // A place whose action is gone falls back to the briefing rather than
  // rendering a dead surface.
  const view: DetailView =
    (requestedView === "review" && !reviewAvailable) ||
    (requestedView === "explain" && !explainAvailable)
      ? "briefing"
      : requestedView;

  const diffComments = useDiffComments(repo, number, isOpen && view === "diff");
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

  // The briefing is a document, not a tab: returning from a place restores its
  // scroll position instead of jumping to the top.
  const briefingRef = useRef<HTMLDivElement | null>(null);
  const briefingScroll = useRef(0);
  useLayoutEffect(() => {
    if (view !== "briefing" || !briefingRef.current) return;
    briefingRef.current.scrollTop = briefingScroll.current;
  }, [view]);

  // Focus enters the place heading and returns to the control that opened it.
  const placeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const previousView = useRef<DetailView>("briefing");
  useEffect(() => {
    const previous = previousView.current;
    if (previous === view) return;
    previousView.current = view;
    if (view === "briefing") {
      const id =
        previous === "review" ? "place-start-review" : `place-link-${previous}`;
      document.getElementById(id)?.focus();
    } else {
      placeHeadingRef.current?.focus();
    }
  }, [view]);

  // Escape must act on the committed state even when this listener has not been
  // rebound yet: after a merge the receipt is on screen while the old closure
  // still carries an open review form or confirmation. A ref keeps the handler
  // current instead of waiting for the effect to re-subscribe.
  const escape = useRef<(event: KeyboardEvent) => void>(() => {});
  escape.current = (event) => {
    if (event.key !== "Escape") return;
    // A line-comment composer or the Manage menu closes itself and marks the
    // event handled.
    if (event.defaultPrevented) return;
    event.preventDefault();
    // Confirmations and the review form outrank navigation: they cannot scroll
    // away, so Escape clears them first. Then a place returns to the briefing,
    // then fullscreen, then the detail itself.
    if (isOpen && confirming !== null) {
      closeConfirm();
      return;
    }
    if (isOpen && reviewOpen) {
      closeReview();
      return;
    }
    if (isOpen && view !== "briefing") {
      setView("briefing");
      return;
    }
    if (fullscreen) {
      toggleFullscreen();
      return;
    }
    closeDetail();
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      escape.current(event);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  // The briefing's review line comes from the review artifact, not from the
  // list's reviewSummary (detail responses do not carry it).
  const artifactReview = reviewController.artifact?.review;
  const reviewStale = Boolean(
    reviewController.artifact &&
    (reviewController.stale ||
      (pr?.headSHA !== "" && reviewController.artifact.sha !== pr?.headSHA)),
  );
  const currentReview = reviewStale ? undefined : artifactReview;

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
        branch={pr?.branch}
        baseBranch={pr?.baseBranch}
        reviewState={pr?.reviewState}
        checkStatus={pr?.checkStatus}
        fullscreen={fullscreen}
        onClose={closeDetail}
        onToggleFullscreen={toggleFullscreen}
        url={pr?.url}
      />

      {detail ? (
        <PRDetailContext value={detail}>
          {isOpen ? <ReviewPanel /> : null}
          {isOpen ? <PRStatePanel /> : null}

          {isOpen ? (
            <>
              <div
                ref={briefingRef}
                data-panel="briefing"
                hidden={view !== "briefing"}
                onScroll={(event) => {
                  briefingScroll.current = event.currentTarget.scrollTop;
                }}
                className="min-h-0 flex-1 overflow-y-auto px-7 pt-4 pb-6.5"
              >
                <Briefing
                  pr={detail.pr}
                  tab={tabID}
                  diff={diffQuery.data}
                  review={currentReview}
                  reviewStale={reviewStale}
                  onOpenInDiff={openDiffAt}
                  onOpenConversation={() => setView("conversation")}
                />
              </div>

              {view !== "briefing" ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  {view === "conversation" ? (
                    <PlaceShell
                      title="Conversation"
                      tail={`${comments.length} ${comments.length === 1 ? "entry" : "entries"}`}
                      headingRef={placeHeadingRef}
                      onBack={() => setView("briefing")}
                    >
                      {comments.length > 0 ? (
                        <Conversation comments={comments} />
                      ) : (
                        <StateView
                          icon={MessageSquare}
                          title="No conversation yet"
                          description="Comments, review verdicts and inline review comments appear here."
                        />
                      )}
                    </PlaceShell>
                  ) : null}

                  {view === "diff" ? (
                    <PlaceShell
                      title="Diff"
                      tail={`${detail.pr.changedFiles} files · +${detail.pr.additions} −${detail.pr.deletions}`}
                      width="full"
                      headingRef={placeHeadingRef}
                      onBack={() => setView("briefing")}
                    >
                      <DiffTab
                        pr={detail.pr}
                        prKey={prKey}
                        diffQuery={diffQuery}
                        comments={diffComments}
                        focusTarget={diffTarget ?? undefined}
                      />
                    </PlaceShell>
                  ) : null}

                  {view === "review" ? (
                    <PlaceShell
                      title="Review"
                      headingRef={placeHeadingRef}
                      onBack={() => setView("briefing")}
                    >
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
                    </PlaceShell>
                  ) : null}

                  {view === "explain" ? (
                    <PlaceShell
                      title="Explain"
                      tail={
                        explain.artifact
                          ? formatRelative(explain.artifact.createdAt)
                          : "on demand"
                      }
                      headingRef={placeHeadingRef}
                      onBack={() => setView("briefing")}
                    >
                      <ExplainPlace controller={explain} />
                    </PlaceShell>
                  ) : null}
                </div>
              ) : null}

              <PlaceBar
                view={view}
                conversationCount={comments.length}
                reviewAvailable={reviewAvailable}
                explainAvailable={explainAvailable}
                onSelect={setView}
                onStartReview={() => setView("review")}
              />
            </>
          ) : (
            <PRSummary pr={detail.pr} />
          )}
        </PRDetailContext>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{loadingOrError}</div>
        </div>
      )}
    </div>
  );
}
