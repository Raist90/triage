import type { DiffFile, DiffHunk, SemanticChange } from "../../lib/types";

/** Stable identity for a file entry in the diff list. */
export function fileKey(file: DiffFile, index: number): string {
  return `${file.path}:${index}`;
}

/** A file whose only sem changes are formatting, whitespace, or comments. */
export function isCosmeticFile(file: DiffFile): boolean {
  const changes = file.semantic ?? [];
  return changes.length > 0 && changes.every((change) => change.cosmetic);
}

/** Deterministic focus rank from the Go side. 0 means unranked. */
export function focusScore(file: DiffFile): number {
  return file.review?.score ?? 0;
}

export function focusBand(file: DiffFile): "high" | "medium" | "low" {
  return file.review?.band ?? "low";
}

export function compareByFocus(a: DiffFile, b: DiffFile): number {
  return focusScore(b) - focusScore(a);
}

/**
 * Plain-language reasons behind a file's score. Counts arrive numeric so the
 * copy lives here, not in the Go scorer.
 */
export function reviewSignals(file: DiffFile): string[] {
  const signals = file.review?.signals;
  if (!signals) return [];

  const labels: string[] = [];
  if (signals.deletes) {
    labels.push(`deletes ${signals.deletes}`);
  }
  if (signals.rewrites) {
    labels.push(
      `${signals.rewrites} rewrite${signals.rewrites === 1 ? "" : "s"}`,
    );
  }
  if (signals.renameRipples) {
    labels.push(
      `rename ripples into ${signals.renameRipples} file${signals.renameRipples === 1 ? "" : "s"}`,
    );
  }
  if (signals.moduleOnly) labels.push("module-level only");
  if (signals.cosmeticOnly) labels.push("cosmetic only");
  if (signals.noTests) labels.push("no tests changed");
  return labels;
}

export type SemanticAnchors = {
  byHunk: SemanticChange[][];
  unanchored: SemanticChange[];
};

/**
 * Assigns every sem change to at most one hunk. sem reports entity ranges that
 * can span several hunks, so matching on range alone would repeat the same
 * annotation above every hunk in a large function. Prefer the first hunk that
 * changed a line inside the entity, then fall back to range overlap.
 */
export function anchorSemanticChanges(
  path: string,
  hunks: DiffHunk[],
  changes: SemanticChange[],
): SemanticAnchors {
  const byHunk = hunks.map(() => [] as SemanticChange[]);
  const unanchored: SemanticChange[] = [];

  for (const change of changes) {
    let target = hunks.findIndex((hunk) => touchesChangedLine(hunk, change));
    if (target < 0) {
      target = hunks.findIndex((hunk) => touchesRange(hunk, change, path));
    }
    if (target >= 0) byHunk[target].push(change);
    else unanchored.push(change);
  }

  return { byHunk, unanchored };
}

function touchesChangedLine(hunk: DiffHunk, change: SemanticChange): boolean {
  return hunk.lines.some(
    (line) =>
      (line.kind === "add" &&
        inRange(line.newNumber, change.startLine, change.endLine)) ||
      (line.kind === "del" &&
        inRange(line.oldNumber, change.oldStartLine, change.oldEndLine)),
  );
}

function touchesRange(
  hunk: DiffHunk,
  change: SemanticChange,
  path: string,
): boolean {
  // A move's old range belongs to the source file; only the new range is
  // local to this file.
  const sameFile = !change.oldFilePath || change.oldFilePath === path;
  return (
    rangeOverlaps(
      hunk.newStart,
      hunk.newCount,
      change.startLine,
      change.endLine,
    ) ||
    (sameFile &&
      rangeOverlaps(
        hunk.oldStart,
        hunk.oldCount,
        change.oldStartLine,
        change.oldEndLine,
      ))
  );
}

function rangeOverlaps(
  start: number,
  count: number,
  changeStart?: number,
  changeEnd?: number,
): boolean {
  if (!changeStart || count <= 0) return false;
  const end = Math.max(changeEnd || changeStart, changeStart);
  return changeStart <= start + count - 1 && end >= start;
}

function inRange(line?: number, start?: number, end?: number): boolean {
  if (!line || !start) return false;
  return line >= start && line <= Math.max(end || start, start);
}

export type DiffFileKind = "test" | "docs" | "generated";

/** Order matches the order of the chips in the diff sidebar. */
export const DIFF_FILE_KINDS: DiffFileKind[] = ["test", "docs", "generated"];

export const FILE_KIND_LABEL: Record<DiffFileKind, string> = {
  test: "Tests",
  docs: "Docs",
  generated: "Generated",
};

/** Every category this path belongs to, classified by the Go side. */
export function fileKinds(file: DiffFile): DiffFileKind[] {
  const declared = file.kinds ?? [];
  return DIFF_FILE_KINDS.filter((kind) => declared.includes(kind));
}

export const FILE_STATUS_MARK: Record<
  DiffFile["status"],
  { mark: string; className: string }
> = {
  added: { mark: "A", className: "border-accent/40 text-accent" },
  removed: { mark: "D", className: "border-danger/40 text-danger" },
  modified: { mark: "M", className: "border-line-strong text-fg-muted" },
  renamed: { mark: "R", className: "border-line-strong text-fg-muted" },
};

export function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return { dir: "", name: path };
  return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}
