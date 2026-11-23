import { EyeOff, Focus, ListTree, PanelRight } from "lucide-react";
import type { SemanticSummary } from "../../../lib/types";
import { IconButton } from "../../../components/ui";
import { diffSummaryParts, type DiffSelection } from "./diffSelection";

export function DiffToolbar({
  summary,
  showSummary,
  selection,
  hideLowPriority,
  focusMode,
  hideCosmetic,
  hasSemantic,
  showSemanticRail,
  pathMode,
  hasPath,
  stepLabel,
  onTogglePathMode,
  onToggleFocusMode,
  onToggleHideCosmetic,
  onToggleSemanticRail,
  onClearFileKinds,
}: {
  summary?: SemanticSummary;
  showSummary: boolean;
  selection: DiffSelection;
  hideLowPriority: boolean;
  focusMode: boolean;
  hideCosmetic: boolean;
  hasSemantic: boolean;
  showSemanticRail: boolean;
  pathMode: boolean;
  hasPath: boolean;
  stepLabel?: string;
  onTogglePathMode: () => void;
  onToggleFocusMode: () => void;
  onToggleHideCosmetic: () => void;
  onToggleSemanticRail: () => void;
  onClearFileKinds: () => void;
}) {
  const summaryParts = diffSummaryParts({
    summary,
    showSummary,
    selection,
    hideLowPriority,
    pathMode,
    stepLabel,
  });

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas pr-1 pl-3">
      <p className="min-w-0 truncate text-meta text-fg-faint tabular-nums">
        {summaryParts.map((part, index) => (
          <span
            key={part.key}
            className={part.key === "step" ? "text-fg-muted" : undefined}
          >
            {index > 0 ? " · " : ""}
            {part.text}
            {part.key === "hidden" ? (
              <button
                type="button"
                onClick={onClearFileKinds}
                className="ml-2 text-fg-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-fg"
              >
                Clear
              </button>
            ) : null}
          </span>
        ))}
      </p>
      <div className="flex shrink-0 items-center gap-0">
        {hasPath ? (
          <IconButton
            label={pathMode ? "Show the file list" : "Group files into steps"}
            active={pathMode}
            onClick={onTogglePathMode}
          >
            <ListTree className="size-4" aria-hidden />
          </IconButton>
        ) : null}
        {pathMode ? null : (
          <IconButton
            label={focusMode ? "Show all files" : "Show one file at a time"}
            active={focusMode}
            onClick={onToggleFocusMode}
          >
            <Focus className="size-4" aria-hidden />
          </IconButton>
        )}
        {selection.cosmeticFiles > 0 ? (
          <IconButton
            label="Hide cosmetic-only files"
            active={hideCosmetic}
            onClick={onToggleHideCosmetic}
          >
            <EyeOff className="size-4" aria-hidden />
          </IconButton>
        ) : null}
        {hasSemantic ? (
          <IconButton
            label={
              showSemanticRail
                ? "Hide semantic change map"
                : "Show semantic change map"
            }
            active={showSemanticRail}
            onClick={onToggleSemanticRail}
          >
            <PanelRight className="size-4" aria-hidden />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
