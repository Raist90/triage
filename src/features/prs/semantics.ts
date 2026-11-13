import type { Complexity, SemanticChange } from "../../lib/types";

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

/**
 * Rail copy for the PR-level complexity: one summary line, then at most two
 * drivers so the section cannot grow past three lines.
 */
export function complexityLines(complexity: Complexity): string[] {
  const lines = [
    `${count(complexity.sourceFiles, "source file")} · ${count(
      complexity.changes,
      "change",
    )}`,
  ];
  const drivers: string[] = [];
  if (complexity.deletes) drivers.push(count(complexity.deletes, "delete"));
  if (complexity.rewrites) drivers.push(count(complexity.rewrites, "rewrite"));
  if (complexity.ripples) {
    drivers.push(`ripples into ${count(complexity.ripples, "file")}`);
  }
  if (drivers.length > 0) lines.push(drivers.slice(0, 2).join(" · "));
  return lines;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
