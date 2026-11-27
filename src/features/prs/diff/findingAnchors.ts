import type { DiffHunk, ReviewFinding } from "../../../lib/types";

/**
 * Findings grouped by the physical diff line they sit under.
 *
 * The key is the line's index inside the hunk, not a line number: a replaced
 * line produces one deletion row and one addition row that both carry the same
 * number, and a finding must render once. New-side line numbers win; a removed
 * file (no new numbers) falls back to the old side.
 */
export function anchorFindings(
  hunk: DiffHunk,
  findings: ReviewFinding[],
): Map<number, ReviewFinding[]> {
  const byLine = new Map<number, ReviewFinding[]>();
  if (findings.length === 0) return byLine;

  for (const finding of findings) {
    let index = hunk.lines.findIndex((line) => line.newNumber === finding.line);
    if (index < 0) {
      index = hunk.lines.findIndex((line) => line.oldNumber === finding.line);
    }
    if (index < 0) continue;
    const bucket = byLine.get(index);
    if (bucket) bucket.push(finding);
    else byLine.set(index, [finding]);
  }
  return byLine;
}

/** Findings for one file, ignoring files the review did not touch. */
export function findingsForFile(
  findings: ReviewFinding[],
  path: string,
): ReviewFinding[] {
  return findings.filter((finding) => finding.file === path);
}
