import { useState } from "react";
import { Button } from "../../../components/ui";
import type { CommentAnchor } from "./diffAnchors";
import { useDiffCommentsContext } from "./DiffCommentsContext";

type CommentComposerProps = {
  anchor: CommentAnchor;
  onDone: () => void;
};

export function CommentComposer({ anchor, onDone }: CommentComposerProps) {
  const { comments, headSHA } = useDiffCommentsContext();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = body.trim();
    if (!text || comments.pending) return;
    setError(null);
    const failure = await comments.submit({
      body: text,
      path: anchor.path,
      line: anchor.line,
      side: anchor.side,
      commitId: headSHA,
    });
    if (failure) {
      setError(failure);
      return;
    }
    onDone();
  }

  return (
    <div className="max-w-3xl">
      <label
        htmlFor={`inline-comment-${anchor.side}-${anchor.line}`}
        className="sr-only"
      >
        Comment on line {anchor.line}
      </label>
      <textarea
        id={`inline-comment-${anchor.side}-${anchor.line}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!comments.pending) onDone();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
        rows={3}
        autoFocus
        placeholder="Leave a comment on this line…"
        className="w-full resize-y rounded-sm border border-line bg-canvas p-2 text-prose text-fg placeholder:text-fg-faint"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={comments.pending || body.trim() === ""}
        >
          {comments.pending ? "Posting…" : "Comment"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={comments.pending}>
          Cancel
        </Button>
        <span className="ml-auto text-micro text-fg-faint">⌘↵ to post</span>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-meta text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
