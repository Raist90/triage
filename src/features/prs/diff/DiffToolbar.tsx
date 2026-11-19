import { EyeOff, Focus, ListTree, PanelRight } from "lucide-react";
import type { SemanticSummary } from "../../../lib/types";
import { IconButton } from "../../../components/ui";
import { summaryText } from "./diffSelection";

type DiffToolbarProps = {
  summary?: SemanticSummary;
  showSummary: boolean;
  highCount: number;
  cosmeticFiles: number;
  hiddenByKind: number;
  hideLowPriority: boolean;
  lowCount: number;
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
};

export function DiffToolbar({
  summary,
  showSummary,
  highCount,
  cosmeticFiles,
  hiddenByKind,
  hideLowPriority,
  lowCount,
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
}: DiffToolbarProps) {
  const hasSummaryLine =
    showSummary || highCount > 0 || (pathMode && stepLabel !== undefined);

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas pr-1 pl-3">
      <p className="min-w-0 truncate text-meta text-fg-faint tabular-nums">
        {pathMode && stepLabel ? (
          <span className="text-fg-muted">{stepLabel}</span>
        ) : null}
        {showSummary ? (
          <span>
            {pathMode && stepLabel ? " · " : ""}
            {summaryText(summary!)}
          </span>
        ) : null}
        {highCount > 0 ? (
          <span>
            {showSummary || (pathMode && stepLabel) ? " · " : ""}
            {highCount} high focus
          </span>
        ) : null}
        {cosmeticFiles > 0 ? (
          <span>
            {hasSummaryLine ? " · " : ""}
            {cosmeticFiles} cosmetic-only{" "}
            {cosmeticFiles === 1 ? "file" : "files"}
          </span>
        ) : null}
        {hiddenByKind > 0 ? (
          <span>
            {hasSummaryLine || cosmeticFiles > 0 ? " · " : ""}
            {hiddenByKind} {hiddenByKind === 1 ? "file" : "files"} hidden
            <button
              type="button"
              onClick={onClearFileKinds}
              className="ml-2 text-fg-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-fg"
            >
              Clear
            </button>
          </span>
        ) : null}
        {hideLowPriority && lowCount > 0 ? (
          <span>
            {hasSummaryLine || cosmeticFiles > 0 || hiddenByKind > 0
              ? " · "
              : ""}
            {lowCount} low focus hidden
          </span>
        ) : null}
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
        <IconButton
          label={focusMode ? "Show all files" : "Show one file at a time"}
          active={focusMode}
          onClick={onToggleFocusMode}
        >
          <Focus className="size-4" aria-hidden />
        </IconButton>
        {cosmeticFiles > 0 ? (
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
