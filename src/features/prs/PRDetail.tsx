import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { describeError, getConfig, getPR } from "../../lib/api";
import { cx } from "../../lib/cx";
import { useLiveRefresh } from "../../lib/liveRefresh";
import { loadDiffForHead } from "../../lib/prRefresh";
import type { ReviewFinding } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { useClaudeAction } from "./action/useClaudeAction";
import { ContextRow } from "./detail/ContextRow";
import { DetailSkeleton } from "./detail/DetailSkeleton";
import { DiffDocument } from "./detail/DiffDocument";
import { ManageMenu } from "./detail/ManageMenu";
import { PRDetailBar } from "./detail/PRDetailBar";
import { PRDetailContext } from "./detail/PRDetailContext";
import { PRStatePanel } from "./detail/PRStatePanel";
import { PRSummary } from "./detail/PRSummary";
import { ReviewBar } from "./detail/ReviewBar";
import { usePRMutations } from "./detail/usePRMutations";
import { useReview } from "./detail/useReview";
import type { DiffTarget } from "./diff/diffSelection";
import { ReviewFindingsContext } from "./diff/ReviewFindingsContext";
import { useDiffComments } from "./diff/useDiffComments";
import { useApplyFinding } from "./review/useApplyFinding";

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
  const barOpen = useUIStore((state) => state.reviewBarOpen);
  const toggleBar = useUIStore((state) => state.toggleReviewBar);
  const prKey = `${repo}#${number}`;

  // The Context row is collapsed by default and is the first thing Escape
  // closes, ahead of fullscreen.
  const [contextOpen, setContextOpen] = useState(false);
  // A finding index jump; the token re-triggers the same target.
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);

  function focusFinding(finding: ReviewFinding) {
    setDiffTarget({
      path: finding.file,
      line: finding.line,
      findingID: finding.id,
      token: Date.now(),
    });
  }

  // A row click lands on the document with Context collapsed. Apply it during
  // render (the React "adjust state when props change" pattern), then clear the
  // store intent in an effect so a refetch or remount cannot replay it.
  const detailIntent = useUIStore((state) => state.detailIntent);
  const clearDetailIntent = useUIStore((state) => state.clearDetailIntent);
  const [appliedIntent, setAppliedIntent] = useState<number | null>(null);
  if (
    detailIntent &&
    detailIntent.prKey === prKey &&
    detailIntent.token !== appliedIntent
  ) {
    setAppliedIntent(detailIntent.token);
    setContextOpen(false);
  }
  useEffect(() => {
    if (detailIntent && detailIntent.prKey === prKey) clearDetailIntent();
  }, [detailIntent, prKey, clearDetailIntent]);

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
  const apply = useApplyFinding(repo, number, reviewController.action);

  // Two different facts: the repository can host a review (local clone), and
  // an action is actually configured to run it.
  const reviewConfigured = configuredRepo?.review.available ?? false;
  const reviewAvailable =
    reviewConfigured &&
    reviewController.enabled &&
    reviewController.action !== null;

  // The diff is the document; comments only load while the PR is open.
  const diffComments = useDiffComments(repo, number, Boolean(isOpen));
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

  // Escape must act on the committed state even when this listener has not been
  // rebound yet: after a merge the receipt is on screen while the old closure
  // still carries an open review form or confirmation. A ref keeps the handler
  // current instead of waiting for the effect to re-subscribe.
  const escape = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    escape.current = (event) => {
      if (event.key !== "Escape") return;
      // A line-comment composer or the Manage menu closes itself and marks the
      // event handled.
      if (event.defaultPrevented) return;
      event.preventDefault();
      // Confirmations and the review form outrank the document: they cannot
      // scroll away, so Escape clears them first. Then Context, then fullscreen,
      // then the detail itself.
      if (isOpen && confirming !== null) {
        closeConfirm();
        return;
      }
      if (isOpen && reviewOpen) {
        closeReview();
        return;
      }
      if (isOpen && contextOpen) {
        setContextOpen(false);
        return;
      }
      if (fullscreen) {
        toggleFullscreen();
        return;
      }
      closeDetail();
    };
  });

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

  // The bar's review line comes from the review artifact, not from the list's
  // reviewSummary (detail responses do not carry it).
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

  // Findings re-render every hunk that reads the context; a run that only
  // streams text must not create a new value.
  const artifact = reviewController.artifact;
  const findingsValue = useMemo(
    () => ({
      review: currentReview,
      artifact,
      stale: reviewStale,
      applying: apply.applying,
      applyFailure: apply.failure,
      onApply: apply.apply,
    }),
    [
      currentReview,
      artifact,
      reviewStale,
      apply.applying,
      apply.failure,
      apply.apply,
    ],
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
        fullscreen={fullscreen}
        barOpen={barOpen}
        onToggleBar={toggleBar}
        onClose={closeDetail}
        onToggleFullscreen={toggleFullscreen}
        url={pr?.url}
        manage={
          detail ? (
            <ManageMenu
              pr={detail.pr}
              review={detail.review}
              mutations={detail.mutations}
            />
          ) : null
        }
      />

      {detail ? (
        <PRDetailContext value={detail}>
          {isOpen ? <PRStatePanel /> : null}

          {isOpen ? (
            <ReviewFindingsContext value={findingsValue}>
              <div
                className={cx(
                  "grid min-h-0 flex-1",
                  barOpen
                    ? "grid-cols-[minmax(0,1fr)_300px]"
                    : "grid-cols-1 wide:grid-cols-[minmax(0,1fr)_300px]",
                )}
              >
                <div className="flex min-h-0 min-w-0 flex-col">
                  <ContextRow
                    description={detail.pr.description}
                    open={contextOpen}
                    onToggle={() => setContextOpen((current) => !current)}
                  />
                  <DiffDocument
                    pr={detail.pr}
                    prKey={prKey}
                    diffQuery={diffQuery}
                    comments={diffComments}
                    focusTarget={diffTarget ?? undefined}
                  />
                </div>
                <ReviewBar
                  pr={detail.pr}
                  review={reviewController}
                  explain={explain}
                  reviewAvailable={reviewAvailable}
                  reviewConfigured={reviewConfigured}
                  stale={reviewStale}
                  unavailableReason={configuredRepo?.review.reason}
                  configPath={configQuery.data?.configPath}
                  onFocusFinding={focusFinding}
                  open={barOpen}
                />
              </div>
            </ReviewFindingsContext>
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
