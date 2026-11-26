import { ChevronDown } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type {
  DiffHunk,
  InlineComment,
  SemanticChange,
} from "../../../lib/types";
import { ChangeAnnotation } from "./DiffAnnotation";
import { FindingThread } from "./FindingThread";
import { anchorFindings, findingsForFile } from "./findingAnchors";
import { anchorKey, lineAnchor, lineAnchors } from "./diffAnchors";
import { LineRow, ROW_GRID } from "./DiffLineRow";
import { useReviewFindings } from "./ReviewFindingsContext";
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
  byAnchor: Map<string, InlineComment[]>;
  draft: string | null;
  onDraftChange: (key: string | null) => void;
};

const EMPTY_COMMENTS: InlineComment[] = [];

/**
 * Memoized: the file patch above re-renders on draft and flash changes, and a
 * hunk that owns neither should not rebuild every line row.
 */
export const HunkRows = memo(function HunkRows({
  hunk,
  hunkKey,
  changes,
  flash,
  path,
  byAnchor,
  draft,
  onDraftChange,
}: HunkRowsProps) {
  const [open, setOpen] = useState(false);
  const { review } = useReviewFindings();
  const findingsByLine = useMemo(
    () => anchorFindings(hunk, findingsForFile(review?.findings ?? [], path)),
    [hunk, path, review],
  );
  const tally = changes.length > 0 ? tallyChanges(changes) : null;
  const dominant = tally?.dominant;

  return (
    <>
      <div
        data-diff-hunk={hunkKey}
        className={`${ROW_GRID} scroll-mt-11 bg-surface ${
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
              className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border bg-canvas px-2 font-sans text-micro transition-colors hover:bg-surface ${badgeClassName(
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
        // Most files have no comments at all: skip two array allocations and a
        // sort per rendered line when the file's anchor map is empty.
        const anchorComments =
          byAnchor.size === 0
            ? EMPTY_COMMENTS
            : lineAnchors(path, line)
                .flatMap((item) => byAnchor.get(anchorKey(item)) ?? [])
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const findings = findingsByLine.get(index) ?? [];
        return (
          <div key={index}>
            <LineRow
              line={line}
              anchor={anchor}
              anchorComments={anchorComments}
              draft={draft}
              onDraftChange={onDraftChange}
            />
            {findings.map((finding) => (
              <FindingThread key={finding.id} finding={finding} />
            ))}
          </div>
        );
      })}
    </>
  );
});
