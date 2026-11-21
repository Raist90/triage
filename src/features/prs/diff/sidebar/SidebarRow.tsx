import type { ReactNode } from "react";
import { cx } from "../../../../lib/cx";

type SidebarRowProps = {
  active: boolean;
  /** What the active row represents to assistive tech, such as "step". */
  current: "location" | "step";
  children: ReactNode;
  className: string;
  onSelect: () => void;
  title: string;
};

/** Selectable row in the diff rail: hover fill plus the active accent rail. */
export function SidebarRow({
  active,
  current,
  children,
  className,
  onSelect,
  title,
}: SidebarRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? current : undefined}
      title={title}
      className={cx(
        "relative w-full text-left transition-colors",
        active
          ? "bg-surface before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
          : "hover:bg-surface/60",
        className,
      )}
    >
      {children}
    </button>
  );
}
