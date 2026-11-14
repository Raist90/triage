import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isHttpUrl(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Opens a link in the system browser, falling back to a new tab in dev. */
export async function openExternal(href: string): Promise<void> {
  if (!isHttpUrl(href)) return;
  if (isTauri()) {
    try {
      await openUrl(href);
      return;
    } catch {
      // Fall through to window.open.
    }
  }
  window.open(href, "_blank", "noreferrer");
}

/**
 * Reveals a worktree in the system file manager. Only meaningful inside Tauri;
 * in the browser the caller keeps showing the path as selectable text.
 */
export async function revealPath(path: string): Promise<void> {
  if (!path || !isTauri()) return;
  try {
    await revealItemInDir(path);
  } catch {
    // Missing permission or a removed directory. The path stays on screen.
  }
}
