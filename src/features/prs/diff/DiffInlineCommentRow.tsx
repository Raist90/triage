import { useState } from "react";
import { Markdown } from "../../../components/Markdown";
import { Button } from "../../../components/ui";
import { cx } from "../../../lib/cx";
import type { InlineComment } from "../../../lib/types";
import { formatRelative } from "../../../lib/time";
import { Avatar } from "../detail/Avatar";
import { useDiffCommentsContext } from "./DiffCommentsContext";

type InlineCommentRowProps = {
  comment: InlineComment;
  canDelete: boolean;
};

/**
 * One GitHub comment under its diff line, shaped like a finding thread: author
 * mark, name, state tag, time on the right, then the body at the same compact
 * measure. The thread frame supplies the 2px rail.
 */
export function InlineCommentRow({
  comment,
  canDelete,
}: InlineCommentRowProps) {
  const { comments } = useDiffCommentsContext();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reply = comment.inReplyToID !== undefined;
  const deleting = comments.deletingID === comment.id;

  async function remove() {
    setError(null);
    const failure = await comments.remove(comment.id);
    if (failure) {
      setError(failure);
      setConfirming(false);
    }
  }

  return (
    <article
      data-comment-id={comment.id}
      className={cx(
        "group scroll-mt-11",
        reply && "border-l-2 border-l-line-strong pl-3",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Avatar name={comment.author} src={comment.avatarURL} size="sm" />
        <span className="min-w-0 truncate text-meta font-medium text-fg-body">
          {comment.author}
        </span>
        {comment.pending ? (
          <span className="inline-flex h-4.5 shrink-0 items-center rounded-sm border border-accent/28 px-1 font-mono text-micro text-accent">
            Pending
          </span>
        ) : null}
        {reply ? (
          <span className="shrink-0 text-micro text-fg-faint">reply</span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint tabular-nums">
          {formatRelative(comment.createdAt)}
        </span>
        {canDelete && !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleting}
            className="shrink-0 text-micro text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100 disabled:opacity-50"
          >
            Delete
          </button>
        ) : null}
      </div>
      <div className="mt-1 max-w-[72ch]">
        <Markdown dense>{comment.body}</Markdown>
      </div>

      {confirming ? (
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => void remove()}
            disabled={deleting}
            className="text-danger hover:bg-danger/10 hover:text-danger"
          >
            {deleting ? "Deleting…" : "Delete comment"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            disabled={deleting}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </article>
  );
}
