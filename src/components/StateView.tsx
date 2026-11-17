import type { LucideIcon } from "lucide-react";
import type { AriaRole, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Kbd } from "./ui";

export type StateHint = {
  keys: string[];
  label: string;
};

type StateViewProps = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  footnote?: ReactNode;
  action?: ReactNode;
  hints?: StateHint[];
  /** Dotted plane behind the copy, for the first screen of the app. */
  dotGrid?: boolean;
  tone?: "default" | "danger";
  /** `fill` centres in the whole pane; `inline` sits in a scrolling panel. */
  layout?: "fill" | "inline";
  /** Announce the state to assistive tech when it appears asynchronously. */
  role?: AriaRole;
  className?: string;
  children?: ReactNode;
};

/** One empty/error/placeholder pattern for every pane. */
export function StateView({
  icon: Icon,
  title,
  description,
  footnote,
  action,
  hints,
  dotGrid = false,
  tone = "default",
  layout = "fill",
  role,
  className,
  children,
}: StateViewProps) {
  return (
    <div
      role={role}
      className={cx(
        "relative flex flex-col items-center justify-center gap-3 py-10 text-center",
        layout === "fill" && "h-full px-6",
        className,
      )}
    >
      {dotGrid ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 dot-grid"
        />
      ) : null}
      {Icon ? (
        <Icon
          className={cx(
            "relative size-5",
            tone === "danger" ? "text-danger" : "text-fg-faint",
          )}
          aria-hidden
        />
      ) : null}
      <p className="relative text-lead font-medium text-fg">{title}</p>
      {description ? (
        <p className="relative max-w-sm text-ui text-fg-faint">{description}</p>
      ) : null}
      {children ? <div className="relative">{children}</div> : null}
      {action ? <div className="relative">{action}</div> : null}
      {footnote ? (
        <p className="relative max-w-sm text-meta text-fg-faint">{footnote}</p>
      ) : null}
      {hints?.length ? (
        <div className="relative flex flex-wrap items-center justify-center gap-3 text-meta text-fg-faint">
          {hints.map((hint) => (
            <span key={hint.label} className="flex items-center gap-2">
              {hint.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
              {hint.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
