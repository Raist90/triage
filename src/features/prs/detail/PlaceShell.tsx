import { ChevronLeft } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { cx } from "../../../lib/cx";

type PlaceShellProps = {
  title: string;
  tail?: string;
  onBack: () => void;
  /** Prose places are centred; the diff takes the full pane width. */
  width?: "prose" | "full";
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
};

/** One place: a back control and title, then its body. No tab semantics. */
export function PlaceShell({
  title,
  tail,
  onBack,
  width = "prose",
  headingRef,
  children,
}: PlaceShellProps) {
  const full = width === "full";

  return (
    <section
      aria-label={`${title} place`}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-meta text-fg-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Briefing
        </button>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 truncate text-lead font-medium text-fg outline-none"
        >
          {title}
        </h2>
        {tail ? (
          <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint tabular-nums">
            {tail}
          </span>
        ) : null}
      </header>

      <div
        className={cx(
          "min-h-0 flex-1",
          full ? "flex flex-col overflow-hidden" : "overflow-y-auto p-4",
        )}
      >
        <div
          className={
            full
              ? "flex min-h-0 flex-1 flex-col"
              : "mx-auto flex w-full max-w-[74ch] flex-col gap-4"
          }
        >
          {children}
        </div>
      </div>
    </section>
  );
}
