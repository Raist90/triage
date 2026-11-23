import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, mock, test } from "bun:test";

let fullscreen = false;
let resizeHandler: (() => void) | undefined;
const unlisten = mock(() => {});
const onResized = mock((handler: () => void) => {
  resizeHandler = handler;
  return Promise.resolve(unlisten);
});
const isFullscreen = mock(() => Promise.resolve(fullscreen));

import * as actualWindow from "@tauri-apps/api/window";

mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen, onResized }),
}));

const { useWindowFullscreen } = await import("./useWindowFullscreen"); // after mock.module: static imports resolve before the mock registers.

type TauriGlobal = { __TAURI_INTERNALS__?: unknown };

afterEach(() => {
  delete (window as TauriGlobal).__TAURI_INTERNALS__;
  mock.module("@tauri-apps/api/window", () => actualWindow);
  mock.clearAllMocks();
  fullscreen = false;
  resizeHandler = undefined;
});

test("follows the window into and out of fullscreen", async () => {
  (window as TauriGlobal).__TAURI_INTERNALS__ = {};
  fullscreen = true;
  const { result } = renderHook(() => useWindowFullscreen());
  await act(async () => {});

  expect(result.current).toBe(true);

  fullscreen = false;
  act(() => resizeHandler?.());
  await act(async () => {});

  expect(result.current).toBe(false);
});

test("releases the resize listener on unmount", async () => {
  (window as TauriGlobal).__TAURI_INTERNALS__ = {};
  const { unmount } = renderHook(() => useWindowFullscreen());
  await act(async () => {});

  const callsBefore = unlisten.mock.calls.length;
  unmount();
  await act(async () => {});

  expect(unlisten.mock.calls.length).toBe(callsBefore + 1);
});

test("stays windowed outside Tauri", async () => {
  const { result } = renderHook(() => useWindowFullscreen());
  await act(async () => {});

  expect(result.current).toBe(false);
  expect(onResized).not.toHaveBeenCalled();
});
