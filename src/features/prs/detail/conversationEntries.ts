import type { Comment, InlineComment } from "../../../lib/types";

export type ConversationEntry = {
  key: string;
  author: string;
  avatarURL?: string;
  body: string;
  createdAt: string;
  kind: Comment["kind"] | "review";
  state?: string;
  /** Present for review comments, which can jump to their diff thread. */
  comment?: InlineComment;
};

export function verdictFor(state: string): string {
  switch (state) {
    case "approved":
      return "approved these changes";
    case "changes_requested":
      return "requested changes";
    case "dismissed":
      return "review dismissed";
    default:
      return "reviewed";
  }
}

export function actionFor(entry: ConversationEntry): string {
  if (entry.kind === "verdict") return verdictFor(entry.state ?? "");
  if (entry.kind === "review") return "left a review comment";
  return "commented";
}

/**
 * Issue comments and verdicts come from the PR detail query; review comments
 * come from the REST comment list, which is the only source that carries their
 * ids, pending state and diff anchor. Entries stay chronological ascending so a
 * thread reads forward.
 */
export function buildEntries(
  comments: Comment[],
  inline: InlineComment[],
): ConversationEntry[] {
  const entries: ConversationEntry[] = comments.map((comment, index) => ({
    key: `${comment.kind}:${comment.createdAt}:${comment.author}:${index}`,
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt,
    kind: comment.kind,
    state: comment.state,
  }));
  for (const comment of inline) {
    entries.push({
      key: `review:${comment.id}`,
      author: comment.author,
      avatarURL: comment.avatarURL,
      body: comment.body,
      createdAt: comment.createdAt,
      kind: "review",
      comment,
    });
  }
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
