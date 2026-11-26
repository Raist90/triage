import { ArrowRight } from "lucide-react";
import { Markdown } from "../../../components/Markdown";
import { cx } from "../../../lib/cx";
import { formatAgo } from "../../../lib/time";
import type { Comment } from "../../../lib/types";
import { Avatar } from "./Avatar";
import {
  actionFor,
  buildEntries,
  entryNodeClass,
  type ConversationEntry,
} from "./conversationEntries";

type ConversationProps = {
  comments: Comment[];
};

/** Full chronological timeline for the Conversation place. */
export function Conversation({ comments }: ConversationProps) {
  const entries = buildEntries(comments);

  return (
    <ol className="relative">
      <span
        aria-hidden="true"
        className="absolute inset-y-2 left-[2.5px] w-px bg-line"
      />
      {entries.map((entry) => {
        const when = formatAgo(entry.createdAt);
        return (
          <li key={entry.key} className="relative pb-6 pl-6 last:pb-0">
            <span
              aria-hidden="true"
              className={cx(
                "absolute top-1 left-0 size-1.5 rounded-full border",
                entryNodeClass(entry),
              )}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-meta">
              <span className="font-medium text-fg">{entry.author}</span>
              <span className="text-fg-faint">{actionFor(entry)}</span>
              {when ? (
                <span className="font-mono text-fg-faint tabular-nums">
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
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The two latest entries, inline in the briefing, in ascending order. */
export function RecentConversation({
  comments,
  onOpenAll,
}: {
  comments: Comment[];
  onOpenAll: () => void;
}) {
  const entries = buildEntries(comments);
  if (entries.length === 0) return null;
  const recent = entries.slice(-2);

  return (
    <div className="flex flex-col gap-3">
      {recent.map((entry) => (
        <RecentEntry key={entry.key} entry={entry} />
      ))}
      <button
        type="button"
        onClick={onOpenAll}
        className="flex items-center gap-1.5 self-start text-meta text-fg-muted transition-colors hover:text-fg"
      >
        All {entries.length} {entries.length === 1 ? "entry" : "entries"}
        <ArrowRight className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function RecentEntry({ entry }: { entry: ConversationEntry }) {
  const when = formatAgo(entry.createdAt);
  return (
    <article className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2.5">
      <Avatar name={entry.author} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-meta text-fg-faint">
          <span className="font-medium text-fg-body">{entry.author}</span>
          <span>{actionFor(entry)}</span>
          {when ? (
            <span className="ml-auto font-mono text-micro tabular-nums">
              {when}
            </span>
          ) : null}
        </div>
        {entry.body.trim() ? (
          <p className="mt-1 line-clamp-2 text-meta leading-5 whitespace-pre-wrap text-fg-muted">
            {entry.body}
          </p>
        ) : null}
      </div>
    </article>
  );
}
