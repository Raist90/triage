import type { DiffFile, ReviewBand, SemanticChange } from "../../lib/types";
import { focusBand, focusScore, reviewSignals } from "./diffFile";

export type ChangeMark = {
  /** Single-character badge, matches the file status marks. */
  mark: string;
  label: string;
  /** Border and text classes for the square badge. */
  badgeClassName: string;
  /** Background (or outline) class for a rail tick and legend swatch. */
  tickClassName: string;
  /** Higher wins when one hunk holds several change types. */
  rank: number;
};

const CHANGE_MARKS: Record<string, ChangeMark> = {
  added: {
    mark: "A",
    label: "added",
    badgeClassName: "border-accent/40 text-accent",
    tickClassName: "bg-accent",
    rank: 5,
  },
  deleted: {
    mark: "D",
    label: "deleted",
    badgeClassName: "border-danger/40 text-danger",
    tickClassName: "bg-danger",
    rank: 6,
  },
  modified: {
    mark: "M",
    label: "modified",
    badgeClassName: "border-line-strong text-fg-muted",
    tickClassName: "bg-fg-muted",
    rank: 3,
  },
  renamed: {
    mark: "R",
    label: "renamed",
    badgeClassName: "border-line-strong text-fg-muted",
    tickClassName: "border border-fg-muted bg-transparent",
    rank: 4,
  },
  moved: {
    mark: "R",
    label: "moved",
    badgeClassName: "border-line-strong text-fg-muted",
    tickClassName: "border border-fg-muted bg-transparent",
    rank: 4,
  },
  reordered: {
    mark: "O",
    label: "reordered",
    badgeClassName: "border-line-strong text-fg-muted",
    tickClassName: "bg-fg-faint",
    rank: 2,
  },
};

const FALLBACK_MARK: ChangeMark = {
  mark: "•",
  label: "changed",
  badgeClassName: "border-line-strong text-fg-muted",
  tickClassName: "bg-fg-faint",
  rank: 1,
};

export function changeMark(change: SemanticChange): ChangeMark {
  return CHANGE_MARKS[change.changeType] ?? FALLBACK_MARK;
}

/** Cosmetic changes read as low-signal everywhere: badge, tick and copy. */
export function isCosmetic(change: SemanticChange): boolean {
  return change.cosmetic === true;
}

export function tickClassName(change: SemanticChange): string {
  return isCosmetic(change) ? "bg-fg-faint" : changeMark(change).tickClassName;
}

export function badgeClassName(change: SemanticChange): string {
  return isCosmetic(change)
    ? "border-line-strong text-fg-faint"
    : changeMark(change).badgeClassName;
}

export type ChangeTally = {
  total: number;
  counts: Record<string, number>;
  /** Highest-signal change in the group, cosmetic counts last. */
  dominant: SemanticChange;
};

export function tallyChanges(changes: SemanticChange[]): ChangeTally {
  const counts: Record<string, number> = {};
  let dominant = changes[0];
  for (const change of changes) {
    counts[change.changeType] = (counts[change.changeType] ?? 0) + 1;
    if (signalRank(change) > signalRank(dominant)) dominant = change;
  }
  return { total: changes.length, counts, dominant };
}

function signalRank(change: SemanticChange): number {
  return isCosmetic(change) ? 0 : changeMark(change).rank;
}

/** "2 modified, 1 added", ordered by signal rather than insertion. */
export function tallyText(tally: ChangeTally): string {
  return Object.entries(tally.counts)
    .sort(
      (a, b) =>
        (CHANGE_MARKS[b[0]]?.rank ?? 1) - (CHANGE_MARKS[a[0]]?.rank ?? 1),
    )
    .map(([type, count]) => `${count} ${CHANGE_MARKS[type]?.label ?? type}`)
    .join(", ");
}

/** One line for a tooltip or the entity row. */
export function changeTitle(change: SemanticChange, filePath: string): string {
  const mark = changeMark(change);
  const where = lineRange(change);
  const source =
    change.oldFilePath && change.oldFilePath !== filePath
      ? ` from ${change.oldFilePath}`
      : change.oldEntityName
        ? ` was ${change.oldEntityName}`
        : "";
  const cosmetic = isCosmetic(change) ? " · cosmetic" : "";
  return `${mark.label} ${change.entityType} ${change.entityName}${source} · ${filePath}${where}${cosmetic}`;
}

function lineRange(change: SemanticChange): string {
  if (!change.startLine) return "";
  const end = Math.max(change.endLine ?? change.startLine, change.startLine);
  return end > change.startLine
    ? `:${change.startLine}-${end}`
    : `:${change.startLine}`;
}

/** Where a change landed in the new file, falling back to the old side. */
export function changeLocation(change: SemanticChange): string {
  if (change.startLine) {
    const end = Math.max(change.endLine ?? change.startLine, change.startLine);
    return end > change.startLine
      ? `${change.startLine}-${end}`
      : `${change.startLine}`;
  }
  return change.oldStartLine ? `${change.oldStartLine}` : "";
}

export type DigestCounts = {
  added: number;
  modified: number;
  deleted: number;
  moved: number;
  cosmetic: number;
};

export type DigestFile = {
  path: string;
  band: ReviewBand;
  score: number;
  counts: DigestCounts;
  signals: string[];
};

export type DigestEntity = {
  change: SemanticChange;
  filePath: string;
};

/**
 * PR-level rollup of sem's per-file report. Files keep their focus order so the
 * reviewer sees where to start, and the entity list keeps cosmetic edits in a
 * muted tail instead of mixing them into the structural changes.
 */
export type SemanticDigest = {
  files: DigestFile[];
  entities: DigestEntity[];
  /** Files with a patch but no sem report, so the digest cannot be silent. */
  unparsed: string[];
  counts: DigestCounts;
  /** Every sem change, cosmetic included. */
  changeCount: number;
  /** Files that carry at least one semantic change. */
  perFileCount: number;
  flags: string[];
};

function emptyCounts(): DigestCounts {
  return { added: 0, modified: 0, deleted: 0, moved: 0, cosmetic: 0 };
}

function countInto(counts: DigestCounts, change: SemanticChange): void {
  if (change.cosmetic) {
    counts.cosmetic += 1;
    return;
  }
  switch (change.changeType) {
    case "added":
      counts.added += 1;
      return;
    case "modified":
      counts.modified += 1;
      return;
    case "deleted":
      counts.deleted += 1;
      return;
    case "moved":
    case "renamed":
    case "reordered":
      counts.moved += 1;
      return;
  }
}

export function semanticDigest(files: DiffFile[]): SemanticDigest {
  const counts = emptyCounts();
  const ranked = files
    .filter((file) => (file.semantic?.length ?? 0) > 0)
    .sort(
      (a, b) => focusScore(b) - focusScore(a) || a.path.localeCompare(b.path),
    );

  const digestFiles: DigestFile[] = [];
  const structural: DigestEntity[] = [];
  const cosmetic: DigestEntity[] = [];
  let changeCount = 0;

  for (const file of ranked) {
    const fileCounts = emptyCounts();
    for (const change of file.semantic ?? []) {
      countInto(counts, change);
      countInto(fileCounts, change);
      changeCount += 1;
      const entry = { change, filePath: file.path };
      if (change.cosmetic) cosmetic.push(entry);
      else structural.push(entry);
    }
    digestFiles.push({
      path: file.path,
      band: focusBand(file),
      score: focusScore(file),
      counts: fileCounts,
      signals: reviewSignals(file),
    });
  }

  const unparsed = files
    .filter(
      (file) =>
        !file.binary &&
        (file.semantic?.length ?? 0) === 0 &&
        file.patch.trim() !== "",
    )
    .map((file) => file.path);

  let rewrites = 0;
  let ripples = 0;
  for (const file of files) {
    rewrites += file.review?.signals.rewrites ?? 0;
    ripples = Math.max(ripples, file.review?.signals.renameRipples ?? 0);
  }
  const noTests = files.some((file) => file.review?.signals.noTests);

  const flags: string[] = [];
  if (counts.deleted > 0) {
    flags.push(
      `${counts.deleted} deleted ${
        counts.deleted === 1 ? "entity" : "entities"
      }`,
    );
  }
  if (rewrites > 0) {
    flags.push(`${rewrites} ${rewrites === 1 ? "rewrite" : "rewrites"}`);
  }
  if (ripples > 0) {
    flags.push(
      `rename ripples into ${ripples} ${ripples === 1 ? "file" : "files"}`,
    );
  }
  if (noTests) flags.push("no tests changed");
  if (changeCount > 0 && counts.cosmetic === changeCount) {
    flags.push("all cosmetic");
  }

  return {
    files: digestFiles,
    entities: [...structural, ...cosmetic],
    unparsed,
    counts,
    changeCount,
    perFileCount: digestFiles.length,
    flags,
  };
}
