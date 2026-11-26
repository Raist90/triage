import type { Comment } from "../../../lib/types";
import { formatAgo } from "../../../lib/time";
import { Avatar } from "./Avatar";
import { actionFor, buildEntries } from "./conversationEntries";

/**
 * Conversation as a bar section: chronological, every entry, bodies clamped to
 * two lines. The full prose is reachable by scrolling the bar, not a place.
 */
export function ConversationSection({ comments }: { comments: Comment[] }) {
  const entries = buildEntries(comments);

  return (
    <section aria-label="Conversation">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-micro font-medium tracking-[0.08em] text-fg-faint uppercase">
          Conversation
        </span>
        <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint tabular-nums">
          {entries.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-meta text-fg-faint">No comments yet.</p>
      ) : (
        <div className="flex flex-col">
          {entries.map((entry) => (
            <article
              key={entry.key}
              className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 border-b border-line/55 py-2 last:border-b-0"
            >
              <Avatar name={entry.author} />
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-1.5 text-meta text-fg-muted">
                  <span className="font-medium text-fg-body">
                    {entry.author}
                  </span>
                  <span className="min-w-0 truncate">{actionFor(entry)}</span>
                  <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint">
                    {formatAgo(entry.createdAt)}
                  </span>
                </div>
                {entry.body.trim() ? (
                  <p className="mt-0.5 line-clamp-2 text-meta leading-4.5 whitespace-pre-wrap text-fg-muted">
                    {entry.body}
                  </p>
                ) : null}
                {entry.path ? (
                  <p className="mt-0.5 truncate font-mono text-micro text-fg-faint">
                    {entry.path}
                    {entry.line ? `:${entry.line}` : ""}
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
