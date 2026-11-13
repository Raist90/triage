import { ArrowRight, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { MicroLabel } from "../../components/ui";
import { cx } from "../../lib/cx";
import type { DiffFile, ReviewBand, SemanticChange } from "../../lib/types";
import { anchorSemanticChanges, splitPath } from "./diffFile";
import {
  badgeClassName,
  changeLocation,
  changeMark,
  isCosmetic,
  semanticDigest,
  type DigestCounts,
  type DigestEntity,
  type DigestFile,
} from "./semantics";

type SemanticDigestProps = {
  files: DiffFile[];
  /** Open the Diff tab on one file, optionally at the hunk owning a change. */
  onOpenChange: (path: string, hunkIndex?: number) => void;
  /** Open the Diff tab without picking a file. */
  onOpenDiff: () => void;
};

const FILE_LIMIT = 5;
const ENTITY_LIMIT = 12;

const BAND_DOT: Record<ReviewBand, string> = {
  high: "bg-accent",
  medium: "bg-fg-muted",
  low: "bg-fg-faint",
};

const BAND_TEXT: Record<ReviewBand, string> = {
  high: "high focus",
  medium: "medium focus",
  low: "low focus",
};

/** Everything sem knows about a pull request, under its description. */
export function SemanticDigest({
  files,
  onOpenChange,
  onOpenDiff,
}: SemanticDigestProps) {
  const digest = useMemo(() => semanticDigest(files), [files]);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [showEntities, setShowEntities] = useState(false);
  const [showAllEntities, setShowAllEntities] = useState(false);

  if (digest.changeCount === 0) return null;

  const visibleFiles = showAllFiles
    ? digest.files
    : digest.files.slice(0, FILE_LIMIT);
  const hiddenFiles = digest.files.length - visibleFiles.length;
  const visibleEntities = showAllEntities
    ? digest.entities
    : digest.entities.slice(0, ENTITY_LIMIT);
  const hiddenEntities = digest.entities.length - visibleEntities.length;

  return (
    <section
      aria-label="Semantic digest"
      className="mt-3 border-t border-line pt-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-3">
        <MicroLabel>Semantic digest</MicroLabel>
        <span className="tabular ml-auto font-mono text-micro text-fg-faint">
          {digest.changeCount} {digest.changeCount === 1 ? "change" : "changes"}
          {` · ${digest.perFileCount}/${files.length} ${
            files.length === 1 ? "file" : "files"
          }`}
          {digest.counts.cosmetic > 0
            ? ` · ${digest.counts.cosmetic} cosmetic`
            : ""}
        </span>
      </div>

      <ul className="mt-1">
        {visibleFiles.map((file) => (
          <li key={file.path}>
            <FileRow file={file} onOpenChange={() => onOpenChange(file.path)} />
          </li>
        ))}
        {hiddenFiles > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setShowAllFiles(true)}
              className="mt-1 rounded-[4px] px-1 py-1 text-micro text-fg-faint transition-colors hover:text-fg-muted"
            >
              {hiddenFiles} more {hiddenFiles === 1 ? "file" : "files"}
            </button>
          </li>
        ) : null}
      </ul>

      {digest.flags.length > 0 ? (
        <p className="mt-1 text-micro text-fg-muted">
          {digest.flags.join(" · ")}
        </p>
      ) : null}

      {digest.unparsed.length > 0 ? (
        <p className="mt-1 text-micro text-fg-faint">
          Not parsed by sem: {formatPaths(digest.unparsed)}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-4 border-t border-line pt-1">
        <button
          type="button"
          onClick={() => setShowEntities((current) => !current)}
          aria-expanded={showEntities}
          className="flex items-center gap-1 rounded-[4px] py-1 text-meta text-fg-muted transition-colors hover:text-fg"
        >
          <ChevronDown
            className={cx(
              "size-3.5 text-fg-faint transition-transform",
              !showEntities && "-rotate-90",
            )}
            aria-hidden
          />
          {digest.entities.length}{" "}
          {digest.entities.length === 1 ? "entity" : "entities"}
        </button>
        <button
          type="button"
          onClick={onOpenDiff}
          className="flex items-center gap-1 rounded-[4px] py-1 text-meta text-fg-faint transition-colors hover:text-fg"
        >
          Open diff
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </div>

      {showEntities ? (
        <div className="mt-1">
          {visibleEntities.map((entity, index) => (
            <EntityRow
              key={`${entity.filePath}:${entity.change.entityType}:${entity.change.entityName}:${entity.change.changeType}:${index}`}
              entity={entity}
              file={files.find((item) => item.path === entity.filePath)}
              onOpenChange={onOpenChange}
            />
          ))}
          {hiddenEntities > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllEntities(true)}
              className="mt-1 rounded-[4px] px-1 py-1 text-micro text-fg-faint transition-colors hover:text-fg-muted"
            >
              {hiddenEntities} more{" "}
              {hiddenEntities === 1 ? "entity" : "entities"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FileRow({
  file,
  onOpenChange,
}: {
  file: DigestFile;
  onOpenChange: () => void;
}) {
  const { dir, name } = splitPath(file.path);
  return (
    <button
      type="button"
      onClick={onOpenChange}
      aria-label={`${file.path}, ${BAND_TEXT[file.band]}, ${deltaText(
        file.counts,
      )}`}
      className="flex w-full flex-col rounded-[4px] px-1 py-1 text-left transition-colors hover:bg-surface"
    >
      <span className="flex w-full items-center gap-2">
        <span
          aria-hidden
          className={cx("size-1.5 shrink-0 rounded-full", BAND_DOT[file.band])}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-meta">
          <span className="text-fg-faint">{dir}</span>
          <span className="text-fg-body">{name}</span>
        </span>
        <Delta counts={file.counts} />
      </span>
      {file.signals.length > 0 ? (
        <span className="truncate pl-4 text-micro text-fg-faint">
          {file.signals.join(" · ")}
        </span>
      ) : null}
    </button>
  );
}

function Delta({ counts }: { counts: DigestCounts }) {
  const parts = [
    counts.added > 0 ? (
      <span key="added" className="text-accent">
        +{counts.added}
      </span>
    ) : null,
    counts.modified > 0 ? (
      <span key="modified" className="text-fg-muted">
        ~{counts.modified}
      </span>
    ) : null,
    counts.deleted > 0 ? (
      <span key="deleted" className="text-danger">
        −{counts.deleted}
      </span>
    ) : null,
    counts.moved > 0 ? (
      <span key="moved" className="text-fg-muted">
        ↗{counts.moved}
      </span>
    ) : null,
    counts.cosmetic > 0 ? (
      <span key="cosmetic" className="text-fg-faint">
        ·{counts.cosmetic}
      </span>
    ) : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    return <span className="text-micro text-fg-faint">no entities</span>;
  }
  return (
    <span className="tabular flex shrink-0 items-center gap-1 font-mono text-micro">
      {parts}
    </span>
  );
}

function EntityRow({
  entity,
  file,
  onOpenChange,
}: {
  entity: DigestEntity;
  file?: DiffFile;
  onOpenChange: (path: string, hunkIndex?: number) => void;
}) {
  const { change, filePath } = entity;
  const mark = changeMark(change);
  const cosmetic = isCosmetic(change);
  const location = changeLocation(change);
  const moved =
    change.changeType === "moved" ||
    change.changeType === "renamed" ||
    change.changeType === "reordered";
  const source = moved
    ? change.oldFilePath && change.oldFilePath !== filePath
      ? change.oldFilePath
      : change.oldEntityName
        ? `was ${change.oldEntityName}`
        : ""
    : "";
  const signature =
    change.oldSignature !== undefined && change.newSignature !== undefined;

  return (
    <div className="flex items-start gap-2 px-1 py-1">
      <span
        className={cx(
          "w-4 shrink-0 rounded-[3px] border text-center text-micro leading-4",
          badgeClassName(change),
        )}
        title={change.changeType}
      >
        {mark.mark}
      </span>
      <span className="w-14 shrink-0 truncate text-micro text-fg-faint">
        {change.entityType}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(filePath, anchoredHunk(file, change))}
            title={filePath}
            className={cx(
              "min-w-0 truncate text-left text-meta transition-colors hover:underline",
              cosmetic ? "text-fg-faint" : "text-fg-body",
            )}
          >
            {change.entityName}
          </button>
          {cosmetic ? (
            <span className="shrink-0 text-micro tracking-[0.06em] text-fg-faint uppercase">
              cosmetic
            </span>
          ) : null}
          {signature ? (
            <span className="shrink-0 text-micro tracking-[0.06em] text-fg-faint uppercase">
              signature
            </span>
          ) : null}
          <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint">
            {shortPath(filePath)}
            {location ? `:${location}` : ""}
          </span>
        </div>
        {source ? (
          <p className="truncate font-mono text-micro text-fg-faint">
            {source}
          </p>
        ) : null}
        {signature ? (
          <div className="mt-1 flex flex-col font-mono text-micro">
            <span className="flex gap-2">
              <span className="w-2 shrink-0 text-danger">−</span>
              <span
                className="truncate text-fg-body"
                title={change.oldSignature}
              >
                {change.oldSignature}
              </span>
            </span>
            <span className="flex gap-2">
              <span className="w-2 shrink-0 text-accent">+</span>
              <span
                className="truncate text-fg-body"
                title={change.newSignature}
              >
                {change.newSignature}
              </span>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The hunk that owns a change, so a click lands on it, not the file top. */
function anchoredHunk(
  file: DiffFile | undefined,
  change: SemanticChange,
): number | undefined {
  if (!file || (file.hunks?.length ?? 0) === 0) return undefined;
  const { byHunk } = anchorSemanticChanges(file.path, file.hunks ?? [], [
    change,
  ]);
  const index = byHunk.findIndex((group) => group.length > 0);
  return index === -1 ? undefined : index;
}

function shortPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 2) return path;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function formatPaths(paths: string[]): string {
  const shown = paths.slice(0, 3).join(", ");
  const rest = paths.length - 3;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

function deltaText(counts: DigestCounts): string {
  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.modified) parts.push(`${counts.modified} modified`);
  if (counts.deleted) parts.push(`${counts.deleted} deleted`);
  if (counts.moved) parts.push(`${counts.moved} moved`);
  if (counts.cosmetic) parts.push(`${counts.cosmetic} cosmetic`);
  return parts.length > 0 ? parts.join(", ") : "no entities";
}
