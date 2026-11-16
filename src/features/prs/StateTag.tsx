import { cx } from "../../lib/cx";

/** Merged, closed or draft marker beside the PR title. */
export function StateTag({
  label,
  merged,
}: {
  label: string;
  merged?: boolean;
}) {
  return (
    <span
      className={cx(
        "shrink-0 rounded-[3px] border border-line px-1 align-middle text-micro font-normal tracking-[0.06em] uppercase",
        merged ? "text-accent" : "text-fg-faint",
      )}
    >
      {label}
    </span>
  );
}
