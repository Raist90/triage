import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useCallback } from "react";
import type { DiffFile } from "../../../lib/types";
import { isCosmeticFile, reviewSignals, splitPath } from "./diffFile";
import { FilePatch } from "./DiffPatch";
import type { DiffCommentsController } from "./useDiffComments";

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  added: "Added",
  removed: "Removed",
  modified: "Modified",
  renamed: "Renamed",
};

type DiffFileSectionProps = {
  file: DiffFile;
  fileKey: string;
  /** Hunk indices a path step owns; undefined renders the whole file. */
  hunks?: number[];
  open: boolean;
  /** Stable across renders: the section supplies its own key. */
  onToggle: (fileKey: string) => void;
  /** Stable across renders: the section registers itself in the scroll map. */
  onSectionRef: (fileKey: string, element: HTMLElement | null) => void;
  comments: DiffCommentsController;
  headSHA: string;
  canComment: boolean;
  /** Only the section that owns the open composer receives the draft key. */
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  viewerLogin?: string;
  /** Only the target section receives the flash label. */
  flash: string | null;
};

/**
 * Memoized so a selection, jump or draft change with every file expanded only
 * re-renders the sections whose own props changed. Every prop here must stay
 * referentially stable; the parent passes shared handlers, never closures.
 */
export const DiffFileSection = memo(function DiffFileSection({
  file,
  fileKey,
  hunks,
  open,
  onToggle,
  onSectionRef,
  comments,
  headSHA,
  canComment,
  draft,
  onDraftChange,
  viewerLogin,
  flash,
}: DiffFileSectionProps) {
  const { dir, name } = splitPath(file.path);
  const signals = reviewSignals(file);
  const fileCommentCount = comments.comments.filter(
    (comment) =>
      comment.path === file.path &&
      comment.commitID === headSHA &&
      comment.line !== undefined,
  ).length;
  const sectionRef = useCallback(
    (element: HTMLElement | null) => onSectionRef(fileKey, element),
    [fileKey, onSectionRef],
  );
  const toggle = useCallback(() => onToggle(fileKey), [fileKey, onToggle]);

  return (
    <section
      data-diff-file={fileKey}
      ref={sectionRef}
      className="border-b border-line last:border-b-0"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-b border-line bg-canvas px-2 text-left transition-colors hover:bg-surface"
      >
        {open ? (
          <ChevronDown
            className="size-3.5 shrink-0 text-fg-faint"
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="size-3.5 shrink-0 text-fg-faint"
            aria-hidden
          />
        )}
        <span className="flex min-w-0 flex-1 items-center font-mono text-meta">
          <span className="inline-block max-w-[55%] truncate align-bottom text-fg-faint">
            {dir}
          </span>
          <span className="shrink-0 text-fg-body">{name}</span>
        </span>
        <span className="shrink-0 text-micro tracking-[0.06em] text-fg-faint uppercase">
          {STATUS_LABEL[file.status]}
        </span>
        {file.oldPath ? (
          <span className="max-w-40 shrink-0 truncate font-mono text-micro text-fg-faint">
            from {file.oldPath}
          </span>
        ) : null}
        {isCosmeticFile(file) ? (
          <span className="shrink-0 text-micro tracking-[0.06em] text-fg-faint uppercase">
            cosmetic
          </span>
        ) : null}
        {signals.length > 0 ? (
          <span
            title={signals.join(" · ")}
            className="max-w-64 shrink-0 truncate text-micro text-fg-faint"
          >
            {signals.join(" · ")}
          </span>
        ) : null}
        {fileCommentCount > 0 ? (
          <span className="shrink-0 text-micro text-fg-faint">
            {fileCommentCount} {fileCommentCount === 1 ? "comment" : "comments"}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 pl-2 font-mono text-meta text-fg-faint tabular-nums">
          <span className="text-accent">+{file.additions}</span>
          <span className="px-1 text-line-strong">/</span>
          <span className="text-danger">−{file.deletions}</span>
        </span>
      </button>

      {open ? (
        <FilePatch
          file={file}
          fileKey={fileKey}
          hunks={hunks}
          comments={comments}
          headSHA={headSHA}
          canComment={canComment}
          draft={draft}
          onDraftChange={onDraftChange}
          viewerLogin={viewerLogin}
          flash={flash}
        />
      ) : null}
    </section>
  );
});
