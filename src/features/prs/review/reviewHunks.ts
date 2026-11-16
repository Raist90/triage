import type { DiffFile, DiffHunk, DiffLine } from "../../../lib/types";
import { findHunkIndex } from "../diff/diffFile";

/** One finding resolved against the diff already loaded by PRDetail. */
export type HunkMatch = {
  file: DiffFile;
  hunk: DiffHunk;
  index: number;
  /** The exact line the finding names, when the hunk contains it. */
  focusedLine?: DiffLine;
};

/**
 * Find the hunk a finding points at. The server decides whether the finding is
 * anchored; a line outside every hunk still resolves to the nearest one so that
 * "Open in diff" has a target, but `focusedLine` stays undefined and callers
 * must not render that hunk as evidence.
 */
export function findHunk(
  files: DiffFile[],
  path: string,
  line: number | undefined,
): HunkMatch | null {
  const file =
    files.find((candidate) => candidate.path === path) ??
    files.find((candidate) => candidate.oldPath === path);
  if (!file || file.binary) return null;

  const hunks = file.hunks ?? [];
  if (hunks.length === 0) return null;

  // An undefined line means "show the first hunk", not "show nothing".
  const index = findHunkIndex(file, line) ?? 0;
  const hunk = hunks[index];
  const focusedLine =
    line === undefined
      ? undefined
      : (hunk.lines.find((candidate) => candidate.newNumber === line) ??
        hunk.lines.find((candidate) => candidate.oldNumber === line));

  return { file, hunk, index, focusedLine };
}

/**
 * Slice at most `max` lines around the focused line, clamped to the hunk.
 * Lines are never synthesized and the real hunk header is kept by the caller.
 */
export function sliceHunk(
  hunk: DiffHunk,
  line: number | undefined,
  max = 12,
): DiffLine[] {
  const lines = hunk.lines;
  if (lines.length <= max) return lines;

  const focus =
    line === undefined
      ? -1
      : lines.findIndex(
          (candidate) =>
            candidate.newNumber === line || candidate.oldNumber === line,
        );
  const anchor = focus < 0 ? 0 : focus;
  const start = Math.max(
    0,
    Math.min(anchor - Math.floor(max / 2), lines.length - max),
  );
  return lines.slice(start, start + max);
}
