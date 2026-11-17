import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, jest, mock, test } from "bun:test";
import { LIVE_BASE_MS, LIVE_MAX_MS, useLiveRefresh } from "./liveRefresh";

const EMPTY = { prs: [] };
const originalHasFocus = document.hasFocus.bind(document);

afterEach(() => {
  document.hasFocus = originalHasFocus;
  jest.useRealTimers();
  mock.restore();
});

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

test("reads at the base gap and backs off while the answer repeats", () => {
  jest.useFakeTimers();
  const refetch = mock(() => {});
  const beforeRefetch = mock(() => {});
  const { rerender } = renderHook(
    ({ data }) => useLiveRefresh(true, data, refetch, beforeRefetch),
    { initialProps: { data: EMPTY } },
  );

  advance(LIVE_BASE_MS - 1);
  expect(refetch).toHaveBeenCalledTimes(0);

  advance(1);
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(beforeRefetch).toHaveBeenCalledTimes(1);

  // Same reference: the gap doubles, so the base gap is not enough.
  advance(LIVE_BASE_MS);
  expect(refetch).toHaveBeenCalledTimes(1);
  advance(LIVE_BASE_MS);
  expect(refetch).toHaveBeenCalledTimes(2);

  // A new answer restarts the backoff at the base gap.
  rerender({ data: { prs: [] } });
  advance(LIVE_BASE_MS);
  expect(refetch).toHaveBeenCalledTimes(3);
});

test("stops while the window is blurred and reads at once on focus", () => {
  jest.useFakeTimers();
  let focused = true;
  document.hasFocus = () => focused;
  const refetch = mock(() => {});
  renderHook(() => useLiveRefresh(true, EMPTY, refetch));

  advance(LIVE_BASE_MS);
  expect(refetch).toHaveBeenCalledTimes(1);

  act(() => {
    focused = false;
    window.dispatchEvent(new Event("blur"));
  });
  advance(LIVE_MAX_MS * 2);
  expect(refetch).toHaveBeenCalledTimes(1);

  act(() => {
    focused = true;
    window.dispatchEvent(new Event("focus"));
  });
  advance(0);
  expect(refetch).toHaveBeenCalledTimes(2);

  // The resume read leaves the next gap at the base interval.
  advance(LIVE_BASE_MS);
  expect(refetch).toHaveBeenCalledTimes(3);
});

test("reads nothing while inactive", () => {
  jest.useFakeTimers();
  const refetch = mock(() => {});
  renderHook(() => useLiveRefresh(false, EMPTY, refetch));

  advance(LIVE_MAX_MS * 4);
  expect(refetch).toHaveBeenCalledTimes(0);
});
