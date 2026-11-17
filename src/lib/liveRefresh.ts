import { useEffect, useRef, useSyncExternalStore } from "react";

/** Fastest gap between live re-reads while the window is focused. */
export const LIVE_BASE_MS = 180_000;

/**
 * Slowest gap, reached after a run of answers that did not change. Matches the
 * GraphQL TTL, so an idle window costs no more than the cache would anyway.
 */
export const LIVE_MAX_MS = 900_000;

function subscribeWindow(onChange: () => void): () => void {
  const events = ["focus", "blur", "visibilitychange"] as const;
  for (const event of events) window.addEventListener(event, onChange);
  return () => {
    for (const event of events) window.removeEventListener(event, onChange);
  };
}

/**
 * Live re-reads only spend GitHub's rate-limit budget while the user is
 * looking. Both checks matter: a blurred window can still be visible, and a
 * background webview can still report focus.
 */
export function liveWindowActive(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function useLiveWindowActive(): boolean {
  return useSyncExternalStore(subscribeWindow, liveWindowActive, () => false);
}

function gapAfter(idlePolls: number): number {
  return Math.min(LIVE_BASE_MS * 2 ** Math.min(idlePolls, 10), LIVE_MAX_MS);
}

/**
 * Re-reads one visible query on a focus-aware timer.
 *
 * `data` is the query's data: TanStack Query keeps the previous reference when
 * structural sharing finds an identical answer, so a changed reference is
 * exactly "GitHub had something new". An unchanged answer doubles the gap up to
 * `LIVE_MAX_MS`; a change resets it to `LIVE_BASE_MS`.
 *
 * `beforeRefetch` runs immediately before each poll so the query can mark that
 * fetch as a deliberate refresh instead of a cached read. Callers pass it
 * because the poll has to bypass the server TTLs: a fresh answer is the point.
 *
 * Blur, a hidden window and `active: false` stop the timer. Coming back to the
 * window reads once straight away.
 */
export function useLiveRefresh(
  active: boolean,
  data: unknown,
  refetch: () => void,
  beforeRefetch?: () => void,
): void {
  const windowActive = useLiveWindowActive();
  const idlePolls = useRef(0);
  const previousData = useRef(data);
  const refetchRef = useRef(refetch);
  const beforeRefetchRef = useRef(beforeRefetch);
  const wasActive = useRef(windowActive);
  // The running chain hands its scheduler out so a new answer can reset it.
  const reschedule = useRef<() => void>(() => {});

  // Latest callbacks, without making the timer chain restart on every render.
  useEffect(() => {
    refetchRef.current = refetch;
    beforeRefetchRef.current = beforeRefetch;
  });

  // A new answer clears the backoff. Re-scheduling (instead of re-rendering)
  // keeps the hook from re-rendering the list every time GitHub answers.
  useEffect(() => {
    if (previousData.current === data) return;
    previousData.current = data;
    idlePolls.current = 0;
    reschedule.current();
  }, [data]);

  useEffect(() => {
    if (!active || !windowActive) {
      wasActive.current = false;
      reschedule.current = () => {};
      return undefined;
    }

    let cancelled = false;
    let timer = 0;
    let resumed = !wasActive.current;
    wasActive.current = true;

    function schedule(delay: number) {
      window.clearTimeout(timer);
      timer = window.setTimeout(poll, delay);
    }

    function poll() {
      if (cancelled) return;
      beforeRefetchRef.current?.();
      refetchRef.current();
      // The resume read is the first read of a new gap, not an idle repeat.
      idlePolls.current = resumed ? 0 : idlePolls.current + 1;
      resumed = false;
      schedule(gapAfter(idlePolls.current));
    }

    // A new answer restarts at the base gap; a focus return reads at once; a
    // fresh mount waits for the first gap.
    reschedule.current = () => schedule(gapAfter(0));
    schedule(resumed ? 0 : gapAfter(idlePolls.current));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      reschedule.current = () => {};
    };
  }, [active, windowActive]);
}
