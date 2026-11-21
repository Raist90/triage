import { cx } from "../../../../lib/cx";

/** Selectable rail row: hover fill plus the active accent rail. */
export function rowClass(active: boolean) {
  return cx(
    "relative w-full text-left transition-colors",
    active
      ? "bg-surface before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
      : "hover:bg-surface/60",
  );
}
