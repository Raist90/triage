import { X } from "lucide-react";
import { Button } from "../../components/ui";
import type { FilterChip } from "./prFilters";

type PRFilterChipsProps = {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClear: () => void;
};

/** Applied facet filters, one removable chip each. Hidden when nothing applies. */
export function PRFilterChips({
  chips,
  onRemove,
  onClear,
}: PRFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onRemove(chip)}
            aria-label={`Remove filter: ${chip.label}`}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-line px-2 text-meta text-fg-body transition-colors hover:border-line-strong hover:text-fg"
          >
            <span
              className={
                chip.section === "authors" || chip.section === "repos"
                  ? "font-mono"
                  : undefined
              }
            >
              {chip.label}
            </span>
            <X className="size-3 text-fg-faint" aria-hidden />
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        onClick={onClear}
        className="shrink-0 px-2 text-meta text-fg-faint hover:bg-transparent hover:text-fg"
      >
        Clear
      </Button>
    </div>
  );
}
