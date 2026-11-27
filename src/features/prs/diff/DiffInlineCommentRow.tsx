import { useState } from "react";
import { Markdown } from "../../../components/Markdown";
import { Button } from "../../../components/ui";
import type { InlineComment } from "../../../lib/types";
import { formatRelative } from "../../../lib/time";
import { Avatar } from "../detail/Avatar";
import { useDiffCommentsContext } from "./DiffCommentsContext";

type InlineCommentRowProps = {
  comment: InlineComment;
  canDelete: boolean;
};

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
      className={`group scroll-mt-11 border-line py-2 first:pt-0 last:pb-0 ${
        reply ? "mt-2 border-l-2 pl-3" : "border-b last:border-b-0"
      }`}
    >
      <div className="flex items-center gap-2 text-meta">
        <Avatar name={comment.author} src={comment.avatarURL} />
        <span className="font-medium text-fg">{comment.author}</span>
        {comment.pending ? (
          <span className="inline-flex h-4.5 shrink-0 items-center rounded-sm border border-accent/28 px-1 font-mono text-micro text-accent">
            Pending
          </span>
        ) : null}
        {reply ? <span className="text-micro text-fg-faint">reply</span> : null}
        <span className="text-fg-faint tabular-nums">
          {formatRelative(comment.createdAt)}
        </span>
        {canDelete && !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleting}
            className="ml-auto text-meta text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100 disabled:opacity-50"
          >
            Delete
          </button>
        ) : null}
      </div>
      <div className="mt-1 max-w-3xl">
        <Markdown>{comment.body}</Markdown>
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
