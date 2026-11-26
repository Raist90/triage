import type { Comment } from "../../../lib/types";

export type ConversationEntry = {
  key: string;
  author: string;
  body: string;
  createdAt: string;
  kind: Comment["kind"];
  state?: string;
  path?: string;
  line?: number;
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
 * The PR body is not a timeline entry: the briefing's Context section owns the
 * description. Entries stay chronological ascending so a thread reads forward.
 */
export function buildEntries(comments: Comment[]): ConversationEntry[] {
  return comments
    .map((comment, index) => ({
      key: `${comment.kind}:${comment.createdAt}:${comment.author}:${index}`,
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt,
      kind: comment.kind,
      state: comment.state,
      path: comment.path,
      line: comment.line,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
