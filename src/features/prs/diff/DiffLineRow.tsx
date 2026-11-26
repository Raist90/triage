import { MessageSquarePlus } from "lucide-react";
import type { DiffLine, InlineComment } from "../../../lib/types";
import { anchorKey, type CommentAnchor } from "./diffAnchors";
import { codeClasses, rowTint, spanClasses } from "./diffRows";
import { CommentComposer } from "./DiffCommentComposer";
import { useDiffCommentsContext } from "./DiffCommentsContext";
import { InlineCommentRow } from "./DiffInlineCommentRow";

export const ROW_GRID = "grid grid-cols-[1.5rem_2.75rem_2.75rem_auto]";

type LineRowProps = {
  line: DiffLine;
  anchor: CommentAnchor | null;
  anchorComments: InlineComment[];
  draft: string | null;
  onDraftChange: (key: string | null) => void;
};

export function LineRow({
  line,
  anchor,
  anchorComments,
  draft,
  onDraftChange,
}: LineRowProps) {
  const { canComment, showComments, viewerLogin } = useDiffCommentsContext();
  const gutter =
    "select-none border-r border-line px-2 text-right text-fg-faint";
  const key = anchor ? anchorKey(anchor) : null;
  const composing = showComments && key !== null && draft === key;
  const thread = showComments ? anchorComments : [];

  return (
    <>
      <div className={`group ${ROW_GRID} ${rowTint(line.kind)}`}>
        <span className="flex items-center justify-center border-r border-line select-none">
          {showComments && anchor && canComment ? (
            <button
              type="button"
              onClick={() => onDraftChange(composing ? null : key)}
              aria-label={composing ? "Cancel comment" : "Comment on this line"}
              title={composing ? "Cancel comment" : "Comment on this line"}
              className="flex size-5 items-center justify-center rounded-sm text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface hover:text-fg focus-visible:opacity-100"
            >
              <MessageSquarePlus className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </span>
        <span className={gutter}>{line.oldNumber || ""}</span>
        <span className={gutter}>{line.newNumber || ""}</span>
        <span className={`${codeClasses(line.kind)} px-3 whitespace-pre`}>
          {line.spans && line.spans.length > 0
            ? line.spans.map((span, index) => (
                <span
                  key={index}
                  className={spanClasses(line.kind, span) || undefined}
                >
                  {span.text}
                </span>
              ))
            : line.text || " "}
        </span>
      </div>

      {thread.length > 0 ? (
        <div className="border-b border-line bg-surface/40 px-3 py-2">
          {thread.map((comment) => (
            <InlineCommentRow
              key={comment.id}
              comment={comment}
              canDelete={
                viewerLogin !== undefined &&
                viewerLogin !== "" &&
                comment.author.toLowerCase() === viewerLogin.toLowerCase()
              }
            />
          ))}
        </div>
      ) : null}

      {composing && anchor ? (
        <div className="border-b border-line bg-surface/40 px-3 py-2">
          <CommentComposer anchor={anchor} onDone={() => onDraftChange(null)} />
        </div>
      ) : null}
    </>
  );
}
