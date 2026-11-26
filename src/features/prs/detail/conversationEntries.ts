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

type Verdict = {
  action: string;
  node: string;
};

export function verdictFor(state: string): Verdict {
  switch (state) {
    case "approved":
      return {
        action: "approved these changes",
        node: "border-accent bg-accent",
      };
    case "changes_requested":
      return {
        action: "requested changes",
        node: "border-danger bg-danger",
      };
    case "dismissed":
      return {
        action: "review dismissed",
        node: "border-line-strong bg-canvas",
      };
    default:
      return { action: "reviewed", node: "border-line-strong bg-canvas" };
  }
}

export function actionFor(entry: ConversationEntry): string {
  if (entry.kind === "verdict") return verdictFor(entry.state ?? "").action;
  if (entry.kind === "review") return "left a review comment";
  return "commented";
}

export function entryNodeClass(entry: ConversationEntry): string {
  if (entry.kind === "verdict") return verdictFor(entry.state ?? "").node;
  return "border-line-strong bg-canvas";
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
