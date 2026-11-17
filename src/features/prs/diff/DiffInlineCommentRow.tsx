import { useState } from "react";
import { Markdown } from "../../../components/Markdown";
import { Button } from "../../../components/ui";
import type { InlineComment } from "../../../lib/types";
import { formatRelative } from "../../../lib/time";
import type { DiffCommentsController } from "./useDiffComments";

type InlineCommentRowProps = {
  comment: InlineComment;
  comments: DiffCommentsController;
  canDelete: boolean;
};

export function InlineCommentRow({
  comment,
  comments,
  canDelete,
}: InlineCommentRowProps) {
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
      className={`group border-line py-2 first:pt-0 last:pb-0 ${
        reply ? "mt-2 border-l-2 pl-3" : "border-b last:border-b-0"
      }`}
    >
      <div className="flex items-center gap-2 text-meta">
        <span className="font-medium text-fg">{comment.author}</span>
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
