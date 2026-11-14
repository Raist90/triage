import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAction,
  describeError,
  getAction,
  runAction,
  streamAction,
} from "../../lib/api";
import type {
  ActionArtifact,
  ActionJob,
  ActionKind,
  ActionResponse,
  ActionStatus,
  ActionView,
  ReviewDocument,
} from "../../lib/types";

export type ClaudeActionController = {
  kind: ActionKind;
  enabled: boolean;
  action: ActionView | null;
  job: ActionJob | undefined;
  /** Job lifecycle as last reported by the server or the local stream. */
  phase: ActionStatus;
  artifact: ActionArtifact | undefined;
  /** Automatic review only: the structured document from the artifact. */
  review: ReviewDocument | undefined;
  /** Automatic review only: the worktree the run used. */
  worktree: string | undefined;
  stale: boolean;
  running: boolean;
  liveText: string;
  error: string | null;
  run: () => void;
  cancel: () => void;
};

const ACTIVE_STATUSES: ReadonlySet<ActionStatus> = new Set<ActionStatus>([
  "queued",
  "preparing",
  "running",
  "validating",
]);

/**
 * One action per PR. Ownership of the run lives here so the header button and
 * the panel below share the same stream; nothing is duplicated into a store.
 *
 * Review jobs stream JSON, so `delta` events are ignored and the answer arrives
 * only through the artifact. Explain keeps its live markdown.
 */
export function useClaudeAction(
  repo: string,
  number: number,
  action: ActionView | null,
  enabled: boolean,
): ClaudeActionController {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["pr-action", repo, number, action?.id ?? ""] as const,
    [repo, number, action?.id],
  );

  const [liveText, setLiveText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<ActionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<ActionArtifact | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const query = useQuery<ActionResponse | null>({
    queryKey,
    queryFn: () =>
      action
        ? getAction({ repo, number, actionID: action.id })
        : Promise.resolve(null),
    enabled: enabled && action !== null,
    retry: false,
    staleTime: 0,
    refetchInterval: (current) => {
      if (streaming) return false;
      const job = current.state.data?.job;
      if (job && ACTIVE_STATUSES.has(job.status)) {
        return 1000;
      }
      return false;
    },
  });

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const run = useCallback(() => {
    if (!action) return;
    abortRef.current?.abort();
    setError(null);
    setLiveText("");
    setFinished(null);
    setStatus(null);
    setStarting(true);

    void (async () => {
      let response: ActionResponse;
      try {
        response = await runAction({ repo, number, actionID: action.id });
      } catch (caught) {
        setStarting(false);
        setError(describeError(caught));
        return;
      }
      if (response.artifact) {
        setFinished(response.artifact);
        setStatus("done");
        setStarting(false);
        invalidate();
        return;
      }
      setStreaming(true);
      setStarting(false);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAction({
          repo,
          number,
          actionID: action.id,
          signal: controller.signal,
          onEvent: (event) => {
            switch (event.type) {
              case "status":
                setStatus(event.status);
                break;
              case "delta":
                if (action.kind === "review") break;
                setLiveText((previous) => previous + event.text);
                break;
              case "done":
                setFinished(event.artifact);
                setStatus("done");
                setStreaming(false);
                invalidate();
                break;
              case "error":
                setError(event.message);
                setStatus("failed");
                setStreaming(false);
                break;
              default:
                break;
            }
          },
        });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(describeError(caught));
      } finally {
        setStreaming(false);
      }
    })();
  }, [action, invalidate, number, repo]);

  const cancel = useCallback(() => {
    if (!action) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStarting(false);
    setStatus("canceled");
    void cancelAction({ repo, number, actionID: action.id })
      .catch(() => undefined)
      .finally(invalidate);
  }, [action, invalidate, number, repo]);

  const job = query.data?.job;
  const phase = status ?? job?.status ?? "queued";
  const running =
    streaming || starting || (job !== undefined && ACTIVE_STATUSES.has(phase));
  const artifact = finished ?? query.data?.artifact;

  return {
    kind: action?.kind ?? "explain",
    enabled,
    action,
    job,
    phase,
    artifact,
    review: artifact?.review,
    worktree: artifact?.worktree,
    stale: finished ? false : (query.data?.stale ?? false),
    running,
    liveText,
    error,
    run,
    cancel,
  };
}
