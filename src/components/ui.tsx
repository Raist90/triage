import type { ComponentProps, ReactNode } from "react";
import { cx } from "../lib/cx";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "ghost" | "outline" | "primary";
};

const BUTTON_VARIANT: Record<NonNullable<ButtonProps["variant"]>, string> = {
  ghost: "text-fg-muted hover:bg-surface hover:text-fg",
  outline:
    "border border-line text-fg-muted hover:border-line-strong hover:text-fg",
  primary: "bg-accent font-medium text-canvas hover:bg-accent/90",
};

/** Compact text button. Chrome is 12px; primary is the only filled control. */
export function Button({
  variant = "ghost",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center gap-2 rounded-[4px] px-2 py-1 text-meta whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

type IconButtonProps = ComponentProps<"button"> & {
  label: string;
  active?: boolean;
};

/** 28px square icon control. Active state is a 2px accent underline. */
export function IconButton({
  label,
  active = false,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cx(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] text-fg-faint transition-colors hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-50",
        active &&
          "text-fg after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

export function MicroLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "text-micro font-medium tracking-[0.08em] text-fg-faint uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-line px-1 font-mono text-micro text-fg-faint">
      {children}
    </kbd>
  );
}

/** Thin rule used between content sections instead of cards. */
export function Rule({ className }: { className?: string }) {
  return <div className={cx("h-px w-full bg-line", className)} />;
}
