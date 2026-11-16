import { cx } from "../../../lib/cx";

type ChangeStatProps = {
  additions: number;
  deletions: number;
  files: number;
  className?: string;
};

/** Additions, deletions and file count, shared by the header and context rail. */
export function ChangeStat({
  additions,
  deletions,
  files,
  className,
}: ChangeStatProps) {
  return (
    <span className={cx("font-mono tabular-nums", className)}>
      <span className="text-accent">+{additions}</span>
      <span className="px-1 text-line-strong">/</span>
      <span className="text-danger">−{deletions}</span>
      <span className="px-1 text-line-strong">·</span>
      {files} files
    </span>
  );
}
