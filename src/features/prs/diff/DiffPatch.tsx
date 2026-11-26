import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { DiffFile, DiffHunk, SemanticChange } from "../../../lib/types";
import { ChangeAnnotation } from "./DiffAnnotation";
import { groupCommentsByAnchor } from "./diffAnchors";
import { anchorSemanticChanges, type SemanticAnchors } from "./diffFile";
import { HunkRows } from "./DiffHunkRows";
import { RawPatch } from "./DiffRawPatch";
import { useDiffCommentsContext } from "./DiffCommentsContext";

const EMPTY_CHANGES: SemanticChange[] = [];
const EMPTY_HUNKS: DiffHunk[] = [];
const EMPTY_ANCHORS: SemanticAnchors = { byHunk: [], unanchored: [] };

type FilePatchProps = {
  file: DiffFile;
  fileKey: string;
  /** Hunk indices a path step owns; undefined renders every hunk. */
  hunks?: number[];
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  /** `${fileKey}:${hunkIndex}` of a rail jump, highlighted briefly. */
  flash: string | null;
};

export function FilePatch({
  file,
  fileKey,
  hunks: scopedHunks,
  draft,
  onDraftChange,
  flash,
}: FilePatchProps) {
  const { comments, headSHA } = useDiffCommentsContext();
  const [showUnanchored, setShowUnanchored] = useState(false);

  const allHunks = file.hunks ?? EMPTY_HUNKS;
  const visible = useMemo(
    () =>
      scopedHunks === undefined
        ? allHunks.map((hunk, index) => ({ hunk, index }))
        : scopedHunks
            .filter((index) => index >= 0 && index < allHunks.length)
            .map((index) => ({ hunk: allHunks[index], index })),
    [allHunks, scopedHunks],
  );

  // Grouping is O(comments) and the semantic anchor pass is O(hunks × changes).
  // Both are shared by every row below, so run them once per patch change, not
  // on every draft, flash or selection render.
  const byAnchor = useMemo(
    () => groupCommentsByAnchor(comments.comments, file.path, headSHA),
    [comments.comments, file.path, headSHA],
  );
  const changes = file.semantic ?? EMPTY_CHANGES;
  const { byHunk, unanchored } = useMemo(
    () =>
      allHunks.length === 0
        ? EMPTY_ANCHORS
        : anchorSemanticChanges(file.path, allHunks, changes),
    [file.path, allHunks, changes],
  );

  if (file.binary) {
    return (
      <p className="border-t border-line bg-canvas px-3 py-2 text-meta text-fg-faint">
        Binary file changed.
      </p>
    );
  }

  if (allHunks.length === 0) {
    return <RawPatch patch={file.patch} />;
  }

  if (visible.length === 0) {
    return (
      <p className="border-t border-line bg-canvas px-3 py-2 text-meta text-fg-faint">
        No hunks from this step in this file.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-line bg-canvas">
      <div className="min-w-max font-mono text-code">
        {scopedHunks === undefined && unanchored.length > 0 ? (
          <div className="border-b border-line">
            <button
              type="button"
              onClick={() => setShowUnanchored((current) => !current)}
              aria-expanded={showUnanchored}
              className="flex h-7 w-full items-center gap-2 px-3 font-sans text-meta text-fg-faint transition-colors hover:bg-surface/60 hover:text-fg-muted"
            >
              <span className="rounded-sm border border-line-strong px-1 font-mono text-micro text-fg-muted">
                {unanchored.length}
              </span>
              unanchored semantic{" "}
              {unanchored.length === 1 ? "change" : "changes"}
              <ChevronDown
                className={`ml-auto size-3.5 transition-transform ${
                  showUnanchored ? "" : "-rotate-90"
                }`}
                aria-hidden
              />
            </button>
            {showUnanchored ? (
              <div className="pb-1">
                {unanchored.map((change, index) => (
                  <ChangeAnnotation
                    key={`${change.entityType}:${change.entityName}:${index}`}
                    change={change}
                    filePath={file.path}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {visible.map(({ hunk, index }) => (
          <div key={`${hunk.header}:${index}`}>
            <HunkRows
              hunk={hunk}
              hunkKey={`${fileKey}:${index}`}
              changes={byHunk[index] ?? EMPTY_CHANGES}
              flash={flash === `${fileKey}:${index}`}
              path={file.path}
              byAnchor={byAnchor}
              draft={draft}
              onDraftChange={onDraftChange}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
