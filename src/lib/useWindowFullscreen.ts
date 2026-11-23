import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

/**
 * Tracks macOS window fullscreen. The title bar strip exists only to hold the
 * traffic lights, so the shell unmounts it once the OS hides them.
 *
 * Fullscreen has no dedicated event: entering and leaving both resize the
 * window, so the state is re-read there.
 */
export function useWindowFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) {
      return;
    }
    const win = getCurrentWindow();
    let listening = true;
    let unlisten: (() => void) | undefined;

    function sync() {
      win.isFullscreen().then(
        (value) => {
          if (listening) setFullscreen(value);
        },
        () => {
          // The window can be gone during teardown; the default stands.
        },
      );
    }

    sync();
    win.onResized(sync).then(
      (stop) => {
        if (listening) unlisten = stop;
        else stop();
      },
      () => {},
    );

    return () => {
      listening = false;
      unlisten?.();
    };
  }, []);

  return fullscreen;
}
