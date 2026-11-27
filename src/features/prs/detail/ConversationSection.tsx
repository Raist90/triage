import type { Comment, InlineComment } from "../../../lib/types";
import { formatAgo } from "../../../lib/time";
import { Avatar } from "./Avatar";
import { actionFor, buildEntries } from "./conversationEntries";

/**
 * Conversation as a bar section: chronological, every entry, bodies clamped to
 * two lines. Review comments jump to their thread on the diff; issue comments
 * have nowhere to land and stay plain.
 */
export function ConversationSection({
  comments,
  inline,
  onFocusComment,
}: {
  comments: Comment[];
  inline: InlineComment[];
  onFocusComment: (comment: InlineComment) => void;
}) {
  const entries = buildEntries(comments, inline);

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
          {entries.map((entry) => {
            const comment = entry.comment;
            const content = (
              <>
                <Avatar name={entry.author} src={entry.avatarURL} />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-baseline gap-1.5 text-meta text-fg-muted">
                    <span className="font-medium text-fg-body">
                      {entry.author}
                    </span>
                    <span className="min-w-0 truncate">{actionFor(entry)}</span>
                    {comment?.pending ? (
                      <span className="inline-flex h-4.5 shrink-0 items-center rounded-sm border border-accent/28 px-1 font-mono text-micro text-accent">
                        Pending
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint">
                      {formatAgo(entry.createdAt)}
                    </span>
                  </div>
                  {entry.body.trim() ? (
                    <p className="mt-0.5 line-clamp-2 text-meta leading-4.5 whitespace-pre-wrap text-fg-muted">
                      {entry.body}
                    </p>
                  ) : null}
                  {comment?.path ? (
                    <p className="mt-0.5 truncate font-mono text-micro text-fg-faint">
                      {comment.path}
                      {comment.line ? `:${comment.line}` : ""}
                      {comment.outdated ? " · outdated" : ""}
                    </p>
                  ) : null}
                </div>
              </>
            );

            if (comment?.path) {
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => onFocusComment(comment)}
                  title={`Jump to ${comment.path}${
                    comment.line ? `:${comment.line}` : ""
                  }`}
                  className="grid w-full grid-cols-[20px_minmax(0,1fr)] gap-2 border-b border-line/55 py-2 text-left transition-colors last:border-b-0 hover:bg-surface focus-visible:bg-surface"
                >
                  {content}
                </button>
              );
            }
            return (
              <article
                key={entry.key}
                className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 border-b border-line/55 py-2 last:border-b-0"
              >
                {content}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
