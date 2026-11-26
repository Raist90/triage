import { ChevronLeft } from "lucide-react";
import type { ReactNode, Ref } from "react";

type PlaceShellProps = {
  title: string;
  tail?: string;
  onBack: () => void;
  /** Prose places are centred; the diff takes the full pane width. */
  width?: "prose" | "full";
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
};

function PlaceHead({
  title,
  tail,
  onBack,
  headingRef,
  bordered,
}: {
  title: string;
  tail?: string;
  onBack: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
  bordered: boolean;
}) {
  return (
    <header
      className={
        bordered
          ? "flex shrink-0 items-center gap-2 border-b border-line px-4 py-3"
          : "flex items-center gap-2.5 border-b border-line pb-3"
      }
    >
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
  );
}

/** One place: a back control and title, then its body. No tab semantics. */
export function PlaceShell({
  title,
  tail,
  onBack,
  width = "prose",
  headingRef,
  children,
}: PlaceShellProps) {
  if (width === "full") {
    return (
      <section
        aria-label={`${title} place`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <PlaceHead
          title={title}
          tail={tail}
          onBack={onBack}
          headingRef={headingRef}
          bordered
        />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    );
  }

  return (
    <section
      aria-label={`${title} place`}
      className="min-h-0 flex-1 overflow-y-auto px-7 pt-4 pb-6.5"
    >
      <div className="mx-auto flex w-full max-w-[74ch] flex-col gap-4">
        <PlaceHead
          title={title}
          tail={tail}
          onBack={onBack}
          headingRef={headingRef}
          bordered={false}
        />
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </section>
  );
}
