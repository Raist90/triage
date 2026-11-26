import { ArrowLeft, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
import { IconButton } from "../../../components/ui";
import { cx } from "../../../lib/cx";
import { openExternal } from "../../../lib/open";

type PRDetailBarProps = {
  repo: string;
  number: number;
  fullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  /** Branch identity; present once the pull request has loaded. */
  branch?: string;
  /** GitHub link target; absent while the pull request is loading. */
  url?: string;
};

export function PRDetailBar({
  repo,
  number,
  fullscreen,
  onClose,
  onToggleFullscreen,
  branch,
  url,
}: PRDetailBarProps) {
  return (
    <div
      data-tauri-drag-region
      className={cx(
        "flex h-11 shrink-0 items-center gap-2 pr-1 pl-2",
        fullscreen && "bg-canvas",
      )}
    >
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 rounded-sm px-2 py-1 text-meta text-fg-muted transition-colors hover:bg-surface hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </button>
      <span className="max-w-56 shrink-0 truncate font-mono text-meta text-fg-faint">
        {repo}
        <span className="px-1 text-line-strong">#</span>
        <span className="text-fg-muted">{number}</span>
      </span>
      {branch ? (
        <span className="hidden min-w-0 truncate font-mono text-meta text-fg-faint min-[1280px]:inline">
          {branch}
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <IconButton
          label={
            fullscreen
              ? "Exit fullscreen"
              : "Enter fullscreen, hide side panels"
          }
          active={fullscreen}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? (
            <Minimize2 className="size-4" aria-hidden />
          ) : (
            <Maximize2 className="size-4" aria-hidden />
          )}
        </IconButton>
        {url ? (
          <button
            type="button"
            onClick={() => void openExternal(url)}
            title="Open on GitHub"
            aria-label="Open on GitHub"
            className="flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-faint transition-colors hover:bg-surface hover:text-fg"
          >
            <ExternalLink className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
