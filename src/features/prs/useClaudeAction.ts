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
  ActionResponse,
  ActionView,
} from "../../lib/types";

export type ClaudeActionController = {
  enabled: boolean;
  action: ActionView | null;
  job: ActionJob | undefined;
  artifact: ActionArtifact | undefined;
  stale: boolean;
  running: boolean;
  liveText: string;
  error: string | null;
  run: () => void;
  cancel: () => void;
};

/**
 * One action per PR. Ownership of the run lives here so the header button and
 * the panel below share the same stream; nothing is duplicated into a store.
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
      if (job && (job.status === "queued" || job.status === "running")) {
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

    void (async () => {
      let response: ActionResponse;
      try {
        response = await runAction({ repo, number, actionID: action.id });
      } catch (caught) {
        setError(describeError(caught));
        return;
      }
      if (response.artifact) {
        setFinished(response.artifact);
        invalidate();
        return;
      }
      setStreaming(true);
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
              case "delta":
                setLiveText((previous) => previous + event.text);
                break;
              case "done":
                setFinished(event.artifact);
                setStreaming(false);
                invalidate();
                break;
              case "error":
                setError(event.message);
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
    void cancelAction({ repo, number, actionID: action.id })
      .catch(() => undefined)
      .finally(invalidate);
  }, [action, invalidate, number, repo]);

  const job = query.data?.job;
  const jobRunning = job?.status === "queued" || job?.status === "running";
  const running = streaming || jobRunning;

  return {
    enabled,
    action,
    job,
    artifact: finished ?? query.data?.artifact,
    stale: finished ? false : (query.data?.stale ?? false),
    running,
    liveText,
    error,
    run,
    cancel,
  };
}
