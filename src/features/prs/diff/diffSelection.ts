import type {
  DiffFile,
  DiffFileKind,
  SemanticSummary,
} from "../../../lib/types";
import type { DiffSort } from "../../../stores/ui";
import {
  compareByFocus,
  DIFF_FILE_KINDS,
  fileKey,
  fileKinds,
  focusBand,
  isCosmeticFile,
} from "./diffFile";

/** A cross-tab jump target owned by PRDetail. */
export type DiffTarget = {
  path: string;
  line?: number;
  token: number;
};

export type DiffFileEntry = {
  file: DiffFile;
  index: number;
  key: string;
};

export type DiffSelectionOptions = {
  hiddenKinds: DiffFileKind[];
  hideCosmetic: boolean;
  hideLowPriority: boolean;
  sort: DiffSort;
};

export type DiffSelection = {
  kindCounts: Record<DiffFileKind, number>;
  /** Files removed because the user hid one of their kinds. */
  hiddenByKind: number;
  /** Files left after the kind filter, before the cosmetic filter. */
  kindFiltered: DiffFile[];
  cosmeticFiles: number;
  hasReview: boolean;
  highCount: number;
  lowCount: number;
  visible: DiffFileEntry[];
};

/**
 * Case-insensitive path search over a prepared rail list. Search is a rail and
 * keyboard concern, not a pane filter: the pane keeps rendering the filtered
 * files so typing does not close the patch being reviewed.
 */
export function filterDiffEntries(
  entries: DiffFileEntry[],
  query: string,
): DiffFileEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(({ file }) => file.path.toLowerCase().includes(needle));
}

/**
 * Applies the kind, cosmetic and low-focus filters, then the priority order.
 * Kept pure so the counters and the rail receive exactly the same list the
 * pane renders.
 */
export function selectDiffFiles(
  files: DiffFile[],
  options: DiffSelectionOptions,
): DiffSelection {
  const { hiddenKinds, hideCosmetic, hideLowPriority, sort } = options;

  const kindCounts = DIFF_FILE_KINDS.reduce(
    (counts, kind) => {
      counts[kind] = files.filter((file) =>
        fileKinds(file).includes(kind),
      ).length;
      return counts;
    },
    {} as Record<DiffFileKind, number>,
  );
  const hiddenByKind = hiddenKinds.length
    ? files.filter((file) =>
        fileKinds(file).some((kind) => hiddenKinds.includes(kind)),
      ).length
    : 0;
  const kindFiltered = files.filter(
    (file) => !fileKinds(file).some((kind) => hiddenKinds.includes(kind)),
  );
  const cosmeticFiles = kindFiltered.filter(isCosmeticFile).length;
  const hasReview = files.some((file) => file.review !== undefined);
  const highCount = files.filter((file) => focusBand(file) === "high").length;
  const baseVisible = files
    .map((file, index) => ({ file, index, key: fileKey(file, index) }))
    .filter(
      ({ file }) =>
        !fileKinds(file).some((kind) => hiddenKinds.includes(kind)) &&
        !(hideCosmetic && isCosmeticFile(file)),
    );
  const lowCount = baseVisible.filter(
    ({ file }) => file.review?.band === "low",
  ).length;
  const visible = baseVisible
    .filter(({ file }) => !(hideLowPriority && file.review?.band === "low"))
    .sort((a, b) =>
      sort === "priority"
        ? compareByFocus(a.file, b.file) || a.index - b.index
        : a.index - b.index,
    );

  return {
    kindCounts,
    hiddenByKind,
    kindFiltered,
    cosmeticFiles,
    hasReview,
    highCount,
    lowCount,
    visible,
  };
}

export type DiffSummaryPart = {
  key: "step" | "summary" | "high" | "cosmetic" | "hidden" | "low";
  text: string;
};

/**
 * Text shown in the diff toolbar, in display order. Separators are the
 * caller's job so a part can stay a plain string and a conditional control
 * (the hidden-kinds Clear) can sit next to its own part.
 */
export function diffSummaryParts({
  summary,
  showSummary,
  selection,
  hideLowPriority,
  pathMode,
  stepLabel,
}: {
  summary?: SemanticSummary;
  showSummary: boolean;
  selection: DiffSelection;
  hideLowPriority: boolean;
  pathMode: boolean;
  stepLabel?: string;
}): DiffSummaryPart[] {
  const parts: DiffSummaryPart[] = [];
  if (pathMode && stepLabel) parts.push({ key: "step", text: stepLabel });
  if (showSummary && summary)
    parts.push({ key: "summary", text: summaryText(summary) });
  if (selection.highCount > 0)
    parts.push({
      key: "high",
      text: `${selection.highCount} high focus`,
    });
  if (selection.cosmeticFiles > 0)
    parts.push({
      key: "cosmetic",
      text: `${selection.cosmeticFiles} cosmetic-only ${
        selection.cosmeticFiles === 1 ? "file" : "files"
      }`,
    });
  if (selection.hiddenByKind > 0)
    parts.push({
      key: "hidden",
      text: `${selection.hiddenByKind} ${
        selection.hiddenByKind === 1 ? "file" : "files"
      } hidden`,
    });
  if (hideLowPriority && selection.lowCount > 0)
    parts.push({
      key: "low",
      text: `${selection.lowCount} low focus hidden`,
    });
  return parts;
}

export function summaryText(summary: SemanticSummary): string {
  const parts = [
    [summary.added, "added"],
    [summary.modified, "modified"],
    [summary.deleted, "deleted"],
    [summary.moved, "moved"],
    [summary.renamed, "renamed"],
    [summary.reordered, "reordered"],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`);

  const total = summary.total;
  return `${total} semantic ${total === 1 ? "change" : "changes"}${
    parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
  }`;
}

/** Rail footer while the file list is showing. */
export function filesSummary(
  visibleCount: number,
  totalCount: number,
  hiddenCount: number,
  highCount: number,
): string {
  const counts =
    hiddenCount === 0
      ? `${totalCount} ${totalCount === 1 ? "file" : "files"}`
      : `${visibleCount} of ${totalCount} files · ${hiddenCount} hidden`;
  return highCount > 0 ? `${counts} · ${highCount} high` : counts;
}

/** Rail footer while path mode lists the steps. */
export function stepsSummary(stepCount: number): string {
  return `${stepCount} ${stepCount === 1 ? "step" : "steps"} · every change covered`;
}
