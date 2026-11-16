import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { DiffHunk, InlineComment, SemanticChange } from "../../lib/types";
import { ChangeAnnotation } from "./DiffAnnotation";
import { anchorKey, lineAnchor, lineAnchors } from "./diffAnchors";
import { LineRow, ROW_GRID } from "./DiffLineRow";
import type { DiffCommentsController } from "./useDiffComments";
import {
  badgeClassName,
  changeMark,
  tallyChanges,
  tallyText,
} from "./semantics";

type HunkRowsProps = {
  hunk: DiffHunk;
  hunkKey: string;
  /** Semantic changes anchored to this hunk; rendered only on demand. */
  changes: SemanticChange[];
  flash: boolean;
  path: string;
  comments: DiffCommentsController;
  headSHA: string;
  byAnchor: Map<string, InlineComment[]>;
  canComment: boolean;
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  viewerLogin?: string;
};

export function HunkRows({
  hunk,
  hunkKey,
  changes,
  flash,
  path,
  comments,
  headSHA,
  byAnchor,
  canComment,
  draft,
  onDraftChange,
  viewerLogin,
}: HunkRowsProps) {
  const [open, setOpen] = useState(false);
  const tally = changes.length > 0 ? tallyChanges(changes) : null;
  const dominant = tally?.dominant;

  return (
    <>
      <div
        data-diff-hunk={hunkKey}
        className={`${ROW_GRID} scroll-mt-9 bg-surface ${
          flash ? "outline -outline-offset-1 outline-accent/50" : ""
        }`}
      >
        <span className="border-r border-line select-none" />
        <span className="border-r border-line select-none" />
        <span className="border-r border-line select-none" />
        <span className="flex min-w-0 items-center gap-2 px-3 py-1 text-fg-faint select-none">
          <span className="min-w-0 truncate">
            {hunk.header}
            {hunk.section ? (
              <span className="pl-2 text-fg-muted">{hunk.section}</span>
            ) : null}
          </span>
          {dominant ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open}
              aria-label={`${tallyText(tally)} in this hunk`}
              title={`${tallyText(tally)} · ${
                changes.length
              } semantic ${changes.length === 1 ? "change" : "changes"}`}
              className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[3px] border bg-canvas px-1.5 font-sans text-micro transition-colors hover:bg-surface ${badgeClassName(
                dominant,
              )}`}
            >
              {changeMark(dominant).mark} {changes.length}
              <ChevronDown
                className={`size-3 transition-transform ${
                  open ? "" : "-rotate-90"
                }`}
                aria-hidden
              />
            </button>
          ) : null}
        </span>
      </div>
      {open && changes.length > 0 ? (
        <div className="border-b border-line pb-1">
          {changes.map((change, index) => (
            <ChangeAnnotation
              key={`${change.entityType}:${change.entityName}:${index}`}
              change={change}
              filePath={path}
            />
          ))}
        </div>
      ) : null}
      {hunk.lines.map((line, index) => {
        const anchor = lineAnchor(path, line);
        const anchorComments = lineAnchors(path, line)
          .flatMap((item) => byAnchor.get(anchorKey(item)) ?? [])
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return (
          <LineRow
            key={index}
            line={line}
            anchor={anchor}
            anchorComments={anchorComments}
            canComment={canComment}
            draft={draft}
            onDraftChange={onDraftChange}
            comments={comments}
            headSHA={headSHA}
            viewerLogin={viewerLogin}
          />
        );
      })}
    </>
  );
}
