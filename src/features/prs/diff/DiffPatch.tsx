import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { DiffFile } from "../../../lib/types";
import { ChangeAnnotation } from "./DiffAnnotation";
import { groupCommentsByAnchor } from "./diffAnchors";
import { anchorSemanticChanges } from "./diffFile";
import { HunkRows } from "./DiffHunkRows";
import { RawPatch } from "./DiffRawPatch";
import type { DiffCommentsController } from "./useDiffComments";

type FilePatchProps = {
  file: DiffFile;
  fileKey: string;
  /** Hunk indices a path step owns; undefined renders every hunk. */
  hunks?: number[];
  comments: DiffCommentsController;
  headSHA: string;
  canComment: boolean;
  draft: string | null;
  onDraftChange: (key: string | null) => void;
  viewerLogin?: string;
  /** `${fileKey}:${hunkIndex}` of a rail jump, highlighted briefly. */
  flash: string | null;
};

export function FilePatch({
  file,
  fileKey,
  hunks: scopedHunks,
  comments,
  headSHA,
  canComment,
  draft,
  onDraftChange,
  viewerLogin,
  flash,
}: FilePatchProps) {
  const [showUnanchored, setShowUnanchored] = useState(false);

  if (file.binary) {
    return (
      <p className="border-t border-line bg-canvas px-3 py-2 text-meta text-fg-faint">
        Binary file changed.
      </p>
    );
  }

  const hunks = file.hunks ?? [];
  if (hunks.length === 0) {
    return <RawPatch patch={file.patch} />;
  }

  const visible =
    scopedHunks === undefined
      ? hunks.map((hunk, index) => ({ hunk, index }))
      : scopedHunks
          .filter((index) => index >= 0 && index < hunks.length)
          .map((index) => ({ hunk: hunks[index], index }));
  if (visible.length === 0) {
    return (
      <p className="border-t border-line bg-canvas px-3 py-2 text-meta text-fg-faint">
        No hunks from this step in this file.
      </p>
    );
  }

  const byAnchor = groupCommentsByAnchor(comments.comments, file.path, headSHA);
  const changes = file.semantic ?? [];
  const { byHunk, unanchored } = anchorSemanticChanges(
    file.path,
    hunks,
    changes,
  );

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
              changes={byHunk[index] ?? []}
              flash={flash === `${fileKey}:${index}`}
              path={file.path}
              comments={comments}
              headSHA={headSHA}
              byAnchor={byAnchor}
              canComment={canComment}
              draft={draft}
              onDraftChange={onDraftChange}
              viewerLogin={viewerLogin}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
