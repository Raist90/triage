import type { DiffLine, InlineComment } from "../../../lib/types";

/** One commentable diff line: GitHub needs path + side + line + head commit. */
export type CommentAnchor = {
  path: string;
  side: "RIGHT" | "LEFT";
  line: number;
};

export function anchorKey(anchor: CommentAnchor): string {
  return `${anchor.path}\u0000${anchor.side}\u0000${anchor.line}`;
}

/** New comments anchor to the side the line belongs to; context defaults right. */
export function lineAnchor(path: string, line: DiffLine): CommentAnchor | null {
  if (line.kind === "del") {
    return line.oldNumber ? { path, side: "LEFT", line: line.oldNumber } : null;
  }
  return line.newNumber ? { path, side: "RIGHT", line: line.newNumber } : null;
}

/** Existing comments may sit on either side of a context line. */
export function lineAnchors(path: string, line: DiffLine): CommentAnchor[] {
  const anchors: CommentAnchor[] = [];
  if (line.oldNumber) {
    anchors.push({ path, side: "LEFT", line: line.oldNumber });
  }
  if (line.newNumber) {
    anchors.push({ path, side: "RIGHT", line: line.newNumber });
  }
  return anchors;
}

/**
 * Comments for one file grouped by anchor and ordered oldest first. Comments on
 * other files, without a resolvable line, or that GitHub has already marked
 * outdated are ignored because they cannot be placed on this patch.
 *
 * The commit they were written at is deliberately not checked: GitHub anchors a
 * comment to the commit it was made against, so every comment carries the old
 * SHA after a rebase or any push. The line it returns is still resolved against
 * the current diff, and a line GitHub can no longer place comes back null,
 * which is exactly `outdated`.
 */
export function groupCommentsByAnchor(
  comments: InlineComment[],
  filePath: string,
): Map<string, InlineComment[]> {
  const byAnchor = new Map<string, InlineComment[]>();
  for (const comment of comments) {
    if (
      comment.path !== filePath ||
      comment.outdated ||
      comment.line === undefined ||
      (comment.side !== "RIGHT" && comment.side !== "LEFT")
    ) {
      continue;
    }
    const anchor: CommentAnchor = {
      path: comment.path,
      side: comment.side,
      line: comment.line,
    };
    const key = anchorKey(anchor);
    const bucket = byAnchor.get(key);
    if (bucket) bucket.push(comment);
    else byAnchor.set(key, [comment]);
  }
  for (const bucket of byAnchor.values()) {
    bucket.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return byAnchor;
}
