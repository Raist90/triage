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
  hiddenCount: number;
  visible: DiffFileEntry[];
  firstVisibleKey: string | null;
  visibleSignature: string;
};

/**
 * Applies the kind, cosmetic and low-focus filters, then the priority order.
 * Kept pure so the counters and the sidebar receive exactly the same list the
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
  const hiddenCount =
    hiddenByKind +
    (hideCosmetic ? cosmeticFiles : 0) +
    (hideLowPriority ? lowCount : 0);
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
    hiddenCount,
    visible,
    firstVisibleKey: visible[0]?.key ?? null,
    visibleSignature: visible.map(({ key }) => key).join("\u0000"),
  };
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
