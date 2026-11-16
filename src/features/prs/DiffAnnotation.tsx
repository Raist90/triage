import type { SemanticChange } from "../../lib/types";
import { badgeClassName, changeMark } from "./semantics";

export function ChangeAnnotation({
  change,
  filePath,
}: {
  change: SemanticChange;
  filePath: string;
}) {
  const moved =
    change.changeType === "moved" || change.changeType === "renamed";
  const source =
    change.oldFilePath && change.oldFilePath !== filePath
      ? change.oldFilePath
      : null;
  const mark = changeMark(change);

  return (
    <div className="flex items-center gap-2 px-3 py-1 font-sans text-meta">
      <span
        className={`w-4 shrink-0 rounded-[3px] border text-center text-micro/4 ${badgeClassName(
          change,
        )}`}
        title={change.changeType}
      >
        {mark.mark}
      </span>
      <span className="shrink-0 text-fg-faint">{change.entityType}</span>
      <span
        className={`truncate ${
          change.cosmetic ? "text-fg-faint" : "text-fg-body"
        }`}
      >
        {change.entityName}
      </span>
      {moved ? (
        <span className="truncate text-micro text-fg-faint">
          {source
            ? `from ${source}`
            : change.oldEntityName
              ? `was ${change.oldEntityName}`
              : "moved"}
        </span>
      ) : null}
      {change.cosmetic ? (
        <span className="shrink-0 text-micro tracking-[0.06em] text-fg-faint uppercase">
          cosmetic
        </span>
      ) : null}
    </div>
  );
}
