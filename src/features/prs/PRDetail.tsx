import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StatusIcon } from "../../components/StatusBadge";
import { Button, IconButton, Kbd, MicroLabel } from "../../components/ui";
import { describeError, getConfig, getPR, getPRDiff } from "../../lib/api";
import { cx } from "../../lib/cx";
import { openExternal } from "../../lib/open";
import { formatRelative } from "../../lib/time";
import type { Complexity, PR, PRDiffResponse } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { ClaudeActionButton, ClaudeActionPanel } from "./ClaudeActionPanel";
import { Conversation } from "./Conversation";
import { DiffView } from "./DiffView";
import { PRStateActions, PRStatePanel } from "./PRStateActions";
import { ReviewHeaderActions } from "./ReviewHeaderActions";
import { ReviewPanel } from "./ReviewPanel";
import { ReviewTab } from "./ReviewTab";
import { complexityLines } from "./semantics";
import { useClaudeAction } from "./useClaudeAction";
import { useDiffComments } from "./useDiffComments";
import { usePRMutations } from "./usePRMutations";
import { useReview } from "./useReview";

type PRDetailProps = {
  repo: string;
  number: number;
};

type DetailTab = "conversation" | "diff" | "review" | "explain";

type TabDef = {
  id: DetailTab;
  label: string;
  count?: number;
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

  const mergePolls = useRef(0);
  const detailQuery = useQuery({
    queryKey: ["pr", repo, number],
    // A poll must bypass the server cache, which may have stored "unknown"
    // right after a draft toggle.
    queryFn: () => getPR({ repo, number, refresh: mergePolls.current > 0 }),
  });

  const diffQuery = useQuery({
    queryKey: ["pr-diff", repo, number],
    queryFn: () => getPRDiff({ repo, number }),
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
      // The merge confirmation and review form close first, then fullscreen,
      // then the detail itself.
      if (mutations.confirmOpen) {
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
      <div
        className={cx(
          "flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1 pl-2",
          fullscreen && "bg-canvas",
        )}
      >
        <button
          type="button"
          onClick={closeDetail}
          className="flex items-center gap-2 rounded-[4px] px-2 py-1 text-meta text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
          <Kbd>Esc</Kbd>
        </button>
        <span className="min-w-0 truncate font-mono text-meta text-fg-faint">
          {repo}
          <span className="px-1 text-line-strong">#</span>
          <span className="text-fg-muted">{number}</span>
        </span>
        {pr ? <ReviewHeaderActions pr={pr} review={review} /> : null}
        {pr ? <PRStateActions pr={pr} mutations={mutations} /> : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton
            label={
              fullscreen
                ? "Exit fullscreen"
                : "Enter fullscreen, hide side panels"
            }
            active={fullscreen}
            onClick={toggleFullscreen}
          >
            {fullscreen ? (
              <Minimize2 className="size-4" aria-hidden />
            ) : (
              <Maximize2 className="size-4" aria-hidden />
            )}
          </IconButton>
          {pr ? (
            <button
              type="button"
              onClick={() => void openExternal(pr.url)}
              title="Open on GitHub"
              aria-label="Open on GitHub"
              className="flex size-7 shrink-0 items-center justify-center rounded-[4px] text-fg-faint transition-colors hover:bg-surface hover:text-fg"
            >
              <ExternalLink className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

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
              <header className="shrink-0 px-4 pt-4 pb-3">
                <h1 className="flex min-w-0 items-baseline gap-2 text-title font-medium tracking-[-0.01em] text-fg">
                  <span className="min-w-0">{pr.title}</span>
                  {pr.state === "merged" ? (
                    <StateTag label="Merged" merged />
                  ) : pr.state === "closed" ? (
                    <StateTag label="Closed" />
                  ) : pr.isDraft ? (
                    <StateTag label="Draft" />
                  ) : null}
                </h1>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-fg-faint">
                  <span className="text-fg-muted">{pr.author}</span>
                  <span className="tabular">
                    updated {formatRelative(pr.updatedAt)}
                  </span>
                  <span className="font-mono">
                    {pr.branch} → {pr.baseBranch}
                  </span>
                  <span className="flex items-center gap-2 min-[1400px]:hidden">
                    <StatusIcon kind="check" state={pr.checkStatus} withLabel />
                    <StatusIcon
                      kind="review"
                      state={pr.reviewState}
                      withLabel
                    />
                  </span>
                  <span className="tabular font-mono">
                    <span className="text-accent">+{pr.additions}</span>
                    <span className="px-1 text-line-strong">/</span>
                    <span className="text-danger">−{pr.deletions}</span>
                    <span className="px-1 text-line-strong">·</span>
                    {pr.changedFiles} files
                  </span>
                </div>
              </header>

              <div
                role="tablist"
                aria-label="Pull request sections"
                className="flex h-9 shrink-0 gap-4 border-b border-line px-4"
              >
                {tabs.map((item) => {
                  const selected = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      id={`detail-tab-${item.id}`}
                      aria-selected={selected}
                      aria-controls={`detail-panel-${item.id}`}
                      onClick={() => setTab(item.id)}
                      className={
                        selected
                          ? "-mb-px flex items-center gap-2 border-b border-accent text-meta font-medium text-fg"
                          : "-mb-px flex items-center gap-2 border-b border-transparent text-meta text-fg-faint transition-colors hover:text-fg-muted"
                      }
                    >
                      {item.label}
                      {typeof item.count === "number" ? (
                        <span className="tabular font-mono text-fg-faint">
                          {item.count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div
                role="tabpanel"
                id={`detail-panel-${activeTab}`}
                aria-labelledby={`detail-tab-${activeTab}`}
                tabIndex={0}
                className={
                  activeTab === "diff"
                    ? "flex min-h-0 flex-1 flex-col outline-none"
                    : "min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none"
                }
              >
                {activeTab === "conversation" ? (
                  <Conversation pr={pr} comments={comments} />
                ) : null}

                {activeTab === "diff" ? (
                  <section className="flex min-h-0 flex-1 flex-col">
                    {diffQuery.isFetching && !diffQuery.isPending ? (
                      <div className="mb-2 flex justify-end">
                        <RefreshCw
                          className="size-3 animate-spin text-fg-faint"
                          aria-label="Refreshing diff"
                        />
                      </div>
                    ) : null}

                    {diffQuery.isPending ? (
                      <div
                        aria-hidden="true"
                        className="m-3 rounded-[6px] border border-line"
                      >
                        {Array.from({ length: 4 }, (_, index) => (
                          <div
                            key={index}
                            className="border-b border-line px-3 py-3 last:border-b-0"
                          >
                            <div className="h-3 w-1/2 animate-pulse rounded-[4px] bg-surface" />
                          </div>
                        ))}
                      </div>
                    ) : diffQuery.isError ? (
                      <div
                        role="alert"
                        className="m-3 rounded-[6px] border border-line p-3 text-meta text-fg-faint"
                      >
                        <p className="text-fg-muted">Can’t load the diff.</p>
                        <p className="mt-1">{describeError(diffQuery.error)}</p>
                        <Button
                          variant="outline"
                          onClick={() => void diffQuery.refetch()}
                          disabled={diffQuery.isFetching}
                          className="mt-2"
                        >
                          {diffQuery.isFetching ? "Retrying…" : "Retry"}
                        </Button>
                      </div>
                    ) : diffQuery.data && diffQuery.data.files.length > 0 ? (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        <DiffView
                          key={prKey}
                          files={diffQuery.data.files}
                          semanticAvailable={diffQuery.data.semanticAvailable}
                          semanticSummary={diffQuery.data.semanticSummary}
                          comments={diffComments}
                          headSHA={pr.headSHA}
                          canComment={pr.state === "open" && pr.headSHA !== ""}
                          viewerLogin={pr.viewerLogin}
                        />
                      </div>
                    ) : (
                      <p className="p-4 text-meta text-fg-faint">
                        No file changes.
                      </p>
                    )}
                  </section>
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
                  />
                ) : null}

                {activeTab === "explain" ? (
                  <section className="max-w-[68ch]">
                    <div className="mb-3 flex justify-end">
                      <ClaudeActionButton controller={explain} />
                    </div>
                    {!explain.artifact && !explain.running && !explain.error ? (
                      <p className="text-prose text-fg-faint">
                        Ask Claude to explain this pull request from its diff.
                      </p>
                    ) : (
                      <ClaudeActionPanel controller={explain} />
                    )}
                  </section>
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

function ContextRail({ pr, diff }: { pr: PR; diff?: PRDiffResponse }) {
  return (
    <aside
      aria-label="Pull request context"
      className="hidden w-[272px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line px-4 py-3 min-[1400px]:flex"
    >
      <section>
        <MicroLabel>Checks</MicroLabel>
        <div className="mt-2">
          <StatusIcon kind="check" state={pr.checkStatus} withLabel />
        </div>
      </section>

      <section>
        <MicroLabel>Review</MicroLabel>
        <div className="mt-2">
          <StatusIcon kind="review" state={pr.reviewState} withLabel />
        </div>
      </section>

      <section>
        <MicroLabel>Change</MicroLabel>
        <p className="tabular mt-2 font-mono text-meta text-fg-muted">
          <span className="text-accent">+{pr.additions}</span>
          <span className="px-1 text-line-strong">/</span>
          <span className="text-danger">−{pr.deletions}</span>
          <span className="px-1 text-line-strong">·</span>
          {pr.changedFiles} files
        </p>
      </section>

      {diff?.complexity ? (
        <section>
          <MicroLabel>Complexity</MicroLabel>
          <ComplexityMeter complexity={diff.complexity} />
        </section>
      ) : null}

      <section>
        <MicroLabel>Branches</MicroLabel>
        <p className="mt-2 font-mono text-meta break-all text-fg-muted">
          {pr.branch}
          <span className="px-1 text-fg-faint">→</span>
          {pr.baseBranch}
        </p>
      </section>

      <section>
        <MicroLabel>Commit</MicroLabel>
        <p className="mt-2 font-mono text-meta text-fg-muted">
          {pr.headSHA.slice(0, 7)}
        </p>
      </section>

      <section>
        <MicroLabel>Opened by</MicroLabel>
        <p className="mt-2 text-meta text-fg-muted">{pr.author}</p>
      </section>

      <section className="mt-auto pt-2">
        <Button
          variant="outline"
          onClick={() => void openExternal(pr.url)}
          className="w-full justify-center"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          Open on GitHub
        </Button>
      </section>
    </aside>
  );
}

const COMPLEXITY_TICKS: Record<Complexity["band"], string> = {
  high: "bg-accent",
  medium: "bg-fg-muted",
  low: "bg-fg-faint",
};

const COMPLEXITY_FILL: Record<Complexity["band"], number> = {
  high: 5,
  medium: 3,
  low: 1,
};

function ComplexityMeter({ complexity }: { complexity: Complexity }) {
  const lines = complexityLines(complexity);
  return (
    <div
      className="mt-2"
      role="img"
      aria-label={`Complexity ${complexity.band}, score ${complexity.score} out of 100. ${lines.join(". ")}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="flex gap-1">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={cx(
                "h-1 w-4 rounded-full",
                index < COMPLEXITY_FILL[complexity.band]
                  ? COMPLEXITY_TICKS[complexity.band]
                  : "bg-line",
              )}
            />
          ))}
        </span>
        <span aria-hidden="true" className="text-meta text-fg-muted">
          {complexity.band}
          <span className="px-1 text-line-strong">·</span>
          <span className="tabular font-mono">{complexity.score}</span>
        </span>
      </div>
      {lines.map((line) => (
        <p
          key={line}
          aria-hidden="true"
          className="mt-1 text-micro text-fg-faint"
        >
          {line}
        </p>
      ))}
    </div>
  );
}

function StateTag({ label, merged }: { label: string; merged?: boolean }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded-[3px] border border-line px-1 align-middle text-micro font-normal tracking-[0.06em] uppercase",
        merged ? "text-accent" : "text-fg-faint",
      )}
    >
      {label}
    </span>
  );
}

function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="px-4 py-4">
      <div className="h-5 w-2/3 animate-pulse rounded-[4px] bg-surface" />
      <div className="mt-3 h-3 w-1/3 animate-pulse rounded-[4px] bg-surface" />
      <div className="mt-6 h-3 w-1/2 animate-pulse rounded-[4px] bg-surface" />
      <div className="mt-3 h-3 w-2/3 animate-pulse rounded-[4px] bg-surface" />
      <div className="mt-3 h-3 w-1/2 animate-pulse rounded-[4px] bg-surface" />
    </div>
  );
}
