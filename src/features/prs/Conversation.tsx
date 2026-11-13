import { Markdown } from "../../components/Markdown";
import { cx } from "../../lib/cx";
import { formatAgo } from "../../lib/time";
import type { Comment, PR } from "../../lib/types";

type ConversationProps = {
  pr: PR;
  comments: Comment[];
};

type Entry = {
  key: string;
  author: string;
  body: string;
  createdAt: string;
  kind: "description" | "comment" | "review" | "verdict";
  state?: string;
  path?: string;
  line?: number;
};

type Verdict = {
  action: string;
  node: string;
};

function verdictFor(state: string): Verdict {
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

function actionFor(entry: Entry): string {
  if (entry.kind === "description") return "opened this PR";
  if (entry.kind === "verdict") return verdictFor(entry.state ?? "").action;
  return "commented";
}

function nodeClass(entry: Entry): string {
  if (entry.kind === "verdict") return verdictFor(entry.state ?? "").node;
  return "border-line-strong bg-canvas";
}

function buildEntries(pr: PR, comments: Comment[]): Entry[] {
  const entries: Entry[] = [
    {
      key: "description",
      author: pr.author,
      body: pr.description,
      createdAt: pr.createdAt ?? "",
      kind: "description",
    },
  ];

  comments.forEach((comment, index) => {
    entries.push({
      key: `${comment.kind}:${comment.createdAt}:${comment.author}:${index}`,
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt,
      kind: comment.kind,
      state: comment.state,
      path: comment.path,
      line: comment.line,
    });
  });

  return entries.sort((a, b) => {
    // An empty timestamp belongs at the top, with the description.
    if (!a.createdAt) return -1;
    if (!b.createdAt) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function Conversation({ pr, comments }: ConversationProps) {
  const entries = buildEntries(pr, comments);

  return (
    <ol className="relative max-w-[68ch]">
      <span
        aria-hidden="true"
        className="absolute top-2 bottom-2 left-[2.5px] w-px bg-line"
      />
      {entries.map((entry) => {
        const when = formatAgo(entry.createdAt);
        return (
          <li key={entry.key} className="relative pb-6 pl-6 last:pb-0">
            <span
              aria-hidden="true"
              className={cx(
                "absolute top-1 left-0 size-1.5 rounded-full border",
                nodeClass(entry),
              )}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-meta">
              <span className="font-medium text-fg">{entry.author}</span>
              <span className="text-fg-faint">{actionFor(entry)}</span>
              {when ? (
                <span className="tabular font-mono text-fg-faint">
                  · {when}
                </span>
              ) : null}
              {entry.path ? (
                <span className="ml-auto font-mono text-fg-faint">
                  {entry.path}
                  {entry.line ? `:${entry.line}` : ""}
                </span>
              ) : null}
            </div>
            {entry.body.trim() ? (
              <div className="mt-2">
                <Markdown>{entry.body}</Markdown>
              </div>
            ) : entry.kind === "description" ? (
              <p className="mt-2 text-prose text-fg-faint">
                No description added.
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
