import { cx } from "../../lib/cx";
import type { PRStatus } from "./prStatus";

const TAGS: Record<
  Exclude<PRStatus, "open">,
  { label: string; accent: boolean }
> = {
  merged: { label: "Merged", accent: true },
  closed: { label: "Closed", accent: false },
  draft: { label: "Draft", accent: false },
};

export function PRStateTag({ status }: { status: PRStatus }) {
  if (status === "open") return null;
  const { label, accent } = TAGS[status];
  return (
    <span
      className={cx(
        "shrink-0 rounded-sm border border-line px-1 align-middle text-micro font-normal tracking-[0.06em] uppercase",
        accent ? "text-accent" : "text-fg-faint",
      )}
    >
      {label}
    </span>
  );
}
