import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { Markdown } from "../../../components/Markdown";
import { cx } from "../../../lib/cx";

/** First meaningful line of the body, markdown markers stripped. */
function excerpt(description: string): string {
  const line =
    description
      .split("\n")
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate !== "") ?? "";
  return line
    .replace(/^#+\s*/, "")
    .replace(/^[-*>\s]+/, "")
    .slice(0, 160);
}

/**
 * The PR body as one row: a one-line preview that grows in place. Collapsed by
 * default; the detail pane owns no other description surface.
 */
export function ContextRow({
  description,
  open,
  onToggle,
}: {
  description: string;
  open: boolean;
  onToggle: () => void;
}) {
  const bodyID = useId();
  if (description.trim() === "") return null;

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyID}
        className={cx(
          "flex h-10 w-full items-center gap-2 px-6 text-left transition-colors hover:bg-surface/55",
          open && "bg-surface/30",
        )}
      >
        <ChevronDown
          className={cx(
            "size-3.5 shrink-0 text-fg-faint transition-transform",
            !open && "-rotate-90",
          )}
          aria-hidden
        />
        <span className="shrink-0 text-meta font-medium text-fg-body">
          Context
        </span>
        {open ? null : (
          <span className="min-w-0 flex-1 truncate text-meta text-fg-faint">
            {excerpt(description)}
          </span>
        )}
        <span className="shrink-0 font-mono text-micro text-fg-faint">
          PR body
        </span>
      </button>
      <div
        id={bodyID}
        hidden={!open}
        className="max-h-[40vh] overflow-y-auto px-6 pb-4 text-ui text-fg-body"
      >
        <Markdown>{description}</Markdown>
      </div>
    </div>
  );
}
