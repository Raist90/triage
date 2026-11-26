import {
  ArrowLeft,
  ExternalLink,
  Maximize2,
  Minimize2,
  PanelRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../../components/ui";
import { cx } from "../../../lib/cx";
import { openExternal } from "../../../lib/open";

type PRDetailBarProps = {
  repo: string;
  number: number;
  fullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  /** Below the wide breakpoint the bar is toggled from this control. */
  barOpen: boolean;
  onToggleBar: () => void;
  /** Branch identity; present once the pull request has loaded. */
  branch?: string;
  /** Target branch, shown after an arrow. */
  baseBranch?: string;
  /** GitHub link target; absent while the pull request is loading. */
  url?: string;
  /** Manage menu; present once the PR and its controllers are loaded. */
  manage?: ReactNode;
};

/**
 * The one identity bar: repository, number, branch and the pane controls.
 * Review state belongs to the review bar, so it is not printed here.
 */
export function PRDetailBar({
  repo,
  number,
  fullscreen,
  onClose,
  onToggleFullscreen,
  barOpen,
  onToggleBar,
  branch,
  baseBranch,
  url,
  manage,
}: PRDetailBarProps) {
  return (
    <div
      data-tauri-drag-region
      className={cx(
        "flex h-11 shrink-0 items-center gap-2 border-b border-line px-2",
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
        <>
          <span
            aria-hidden="true"
            className="size-0.5 shrink-0 rounded-full bg-line-strong"
          />
          <span className="hidden min-w-0 truncate font-mono text-meta text-fg-faint min-[1280px]:inline">
            {branch}
            {baseBranch ? ` → ${baseBranch}` : null}
          </span>
        </>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <IconButton
          label={barOpen ? "Hide review bar" : "Show review bar"}
          active={barOpen}
          onClick={onToggleBar}
          className="wide:hidden"
        >
          <PanelRight className="size-4" aria-hidden />
        </IconButton>
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
        {manage}
        {url ? (
          <IconButton
            label="Open on GitHub"
            onClick={() => void openExternal(url)}
          >
            <ExternalLink className="size-4" aria-hidden />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
