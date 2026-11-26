import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useRef } from "react";
import type { DiffFile } from "../../../lib/types";
import {
  estimateDiffBodyHeight,
  isCosmeticFile,
  reviewSignals,
  splitPath,
} from "./diffFile";
import { useDiffCommentsContext } from "./DiffCommentsContext";
import { FilePatch } from "./DiffPatch";

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
  /** Only the section that owns the open composer receives the draft key. */
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  /** Only the target section receives the flash label. */
  flash: string | null;
  /** False until the pane's observer says this section is near the viewport. */
  mount: boolean;
  /** Reports how a lazily mounted body differs from its placeholder height. */
  onBodySettled: (fileKey: string, delta: number) => void;
};

/**
 * Memoized so a selection, jump or draft change with every file expanded only
 * re-renders the sections whose own props changed. Every prop here must stay
 * referentially stable; the parent passes shared handlers, never closures.
 * The review surface comes from context and is fixed for the diff's lifetime.
 */
export const DiffFileSection = memo(function DiffFileSection({
  file,
  fileKey,
  hunks,
  open,
  onToggle,
  onSectionRef,
  draft,
  onDraftChange,
  flash,
  mount,
  onBodySettled,
}: DiffFileSectionProps) {
  const { comments, headSHA } = useDiffCommentsContext();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Height the placeholder occupied before the body mounted. Zero once the
  // body owns the space, so later re-renders do not report twice.
  const placeholderHeight = useRef(0);
  const estimate = open && !mount ? estimateDiffBodyHeight(file, hunks) : 0;

  useLayoutEffect(() => {
    if (open && !mount) placeholderHeight.current = estimate;
  }, [open, mount, estimate]);

  // Keep the visible rows still when a body above the viewport mounts with a
  // different height than its placeholder: the parent owns the pane's scroll.
  useLayoutEffect(() => {
    const previous = placeholderHeight.current;
    if (!open || !mount || previous === 0 || !bodyRef.current) return;
    placeholderHeight.current = 0;
    const delta = bodyRef.current.offsetHeight - previous;
    if (delta !== 0) onBodySettled(fileKey, delta);
  }, [open, mount, fileKey, onBodySettled]);
  const { dir, name } = splitPath(file.path);
  const signals = reviewSignals(file);
  const fileCommentCount = comments.comments.filter(
    (comment) =>
      comment.path === file.path &&
      comment.commitID === headSHA &&
      comment.line !== undefined,
  ).length;
  const meta = [
    STATUS_LABEL[file.status],
    file.oldPath ? `from ${file.oldPath}` : "",
    isCosmeticFile(file) ? "cosmetic" : "",
    ...signals,
    fileCommentCount > 0
      ? `${fileCommentCount} ${fileCommentCount === 1 ? "comment" : "comments"}`
      : "",
  ].filter(Boolean);
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
        className="sticky top-0 z-10 flex h-11 w-full items-center gap-2 border-b border-line bg-surface px-6 text-left transition-colors hover:bg-raised"
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
        <span className="flex min-w-0 flex-1 items-baseline truncate font-mono text-meta">
          <span className="truncate text-fg-faint">{dir}</span>
          <span className="shrink-0 text-fg-body">{name}</span>
        </span>
        {meta.length > 0 ? (
          <span
            title={meta.join(" · ")}
            className="hidden max-w-[46%] min-w-0 shrink truncate text-micro text-fg-faint min-[560px]:inline"
          >
            {meta.join(" · ")}
          </span>
        ) : null}
        <span className="shrink-0 pl-2 font-mono text-meta text-fg-faint tabular-nums">
          <span className="text-accent">+{file.additions}</span>
          <span className="px-1 text-line-strong">/</span>
          <span className="text-danger">−{file.deletions}</span>
        </span>
      </button>

      {open ? (
        <div ref={bodyRef}>
          {mount ? (
            <FilePatch
              file={file}
              fileKey={fileKey}
              hunks={hunks}
              draft={draft}
              onDraftChange={onDraftChange}
              flash={flash}
            />
          ) : (
            <div
              aria-hidden
              className="border-t border-line bg-canvas"
              style={{ height: estimate }}
            />
          )}
        </div>
      ) : null}
    </section>
  );
});
