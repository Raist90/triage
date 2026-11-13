import { Check, Minus, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button, IconButton, MicroLabel } from "../../components/ui";
import { cx } from "../../lib/cx";
import type { CheckState, PR, ReviewState } from "../../lib/types";
import type { PRFilterSection, PRFilters } from "../../stores/ui";
import { facetCounts, type FacetOption } from "./prFilters";

type PRFilterPopoverProps = {
  /** The unfiltered list, used for facet counts. */
  prs: PR[];
  filters: PRFilters;
  /** The repo facet is redundant while a single repo is in scope. */
  showRepos: boolean;
  shown: number;
  total: number;
  onToggleFacet: (section: PRFilterSection, value: string) => void;
  onSetFacet: (section: PRFilterSection, values: string[]) => void;
  onToggleDrafts: () => void;
  onClear: () => void;
  onClose: () => void;
};

/**
 * Floating facet panel for the PR list. Filtering is live: every toggle edits
 * the store and the list re-renders, so there is no Apply button.
 */
export function PRFilterPopover({
  prs,
  filters,
  showRepos,
  shown,
  total,
  onToggleFacet,
  onSetFacet,
  onToggleDrafts,
  onClear,
  onClose,
}: PRFilterPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const counts = facetCounts(prs, filters);

  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLInputElement>('input[data-facet-row="true"]')
      ?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Filter pull requests"
      className="absolute top-8 right-0 z-30 flex max-h-[min(480px,70vh)] w-64 flex-col overflow-hidden rounded-[6px] border border-line-strong bg-canvas"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line pr-1 pl-3">
        <span className="text-ui font-medium text-fg">Filter</span>
        <IconButton label="Close filters" onClick={onClose}>
          <X className="size-3.5" aria-hidden />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Section
          label="Review"
          options={counts.review}
          selected={filters.review}
          onSelectAll={(values) => onSetFacet("review", values)}
        >
          {counts.review.map((option) => (
            <FacetRow
              key={option.value}
              option={option}
              checked={filters.review.includes(option.value as ReviewState)}
              onToggle={() => onToggleFacet("review", option.value)}
            />
          ))}
        </Section>

        <Section
          label="Checks"
          options={counts.checks}
          selected={filters.checks}
          onSelectAll={(values) => onSetFacet("checks", values)}
        >
          {counts.checks.map((option) => (
            <FacetRow
              key={option.value}
              option={option}
              checked={filters.checks.includes(option.value as CheckState)}
              onToggle={() => onToggleFacet("checks", option.value)}
            />
          ))}
        </Section>

        {showRepos ? (
          <Section
            label="Repository"
            options={counts.repos}
            selected={filters.repos}
            onSelectAll={(values) => onSetFacet("repos", values)}
          >
            {counts.repos.map((option) => (
              <FacetRow
                key={option.value}
                option={option}
                mono
                checked={filters.repos.includes(option.value)}
                onToggle={() => onToggleFacet("repos", option.value)}
              />
            ))}
          </Section>
        ) : null}

        <Section
          label="Author"
          options={counts.authors}
          selected={filters.authors}
          onSelectAll={(values) => onSetFacet("authors", values)}
        >
          {counts.authors.map((option) => (
            <FacetRow
              key={option.value}
              option={option}
              checked={filters.authors.includes(option.value)}
              onToggle={() => onToggleFacet("authors", option.value)}
            />
          ))}
        </Section>

        <div className="mt-1 border-t border-line pt-1">
          <label className="flex h-7 cursor-default items-center gap-2 rounded-[4px] px-1 text-ui text-fg-body hover:bg-surface/60">
            <input
              type="checkbox"
              checked={filters.hideDrafts}
              onChange={onToggleDrafts}
              className="peer sr-only"
            />
            <Checkbox checked={filters.hideDrafts} />
            <span className="min-w-0 flex-1 truncate">Hide drafts</span>
          </label>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center justify-between border-t border-line pr-2 pl-3">
        <Button
          variant="ghost"
          onClick={onClear}
          className="px-0 text-fg-muted hover:bg-transparent"
        >
          Clear all
        </Button>
        <span className="tabular font-mono text-micro text-fg-faint">
          {shown} of {total}
        </span>
      </div>
    </div>
  );
}

function Section({
  label,
  options,
  selected,
  onSelectAll,
  children,
}: {
  label: string;
  options: FacetOption[];
  selected: string[];
  onSelectAll: (values: string[]) => void;
  children: ReactNode;
}) {
  if (options.length === 0) return null;
  const selectedSet = new Set(selected);
  const selectedCount = options.filter((option) =>
    selectedSet.has(option.value),
  ).length;
  const all = selectedCount === options.length;
  return (
    <section className="py-1">
      <div className="flex items-center justify-between px-1 pb-1">
        <MicroLabel>{label}</MicroLabel>
        <MasterCheckbox
          label={label}
          checked={all}
          indeterminate={selectedCount > 0 && !all}
          onToggle={() =>
            onSelectAll(all ? [] : options.map((option) => option.value))
          }
        />
      </div>
      {children}
    </section>
  );
}

/** Tri-state select-all control in a section header. */
function MasterCheckbox({
  label,
  checked,
  indeterminate,
  onToggle,
}: {
  label: string;
  checked: boolean;
  indeterminate: boolean;
  onToggle: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      title={checked ? `Clear ${label}` : `Select all ${label}`}
      className="flex cursor-default items-center"
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Select all ${label}`}
        className="peer sr-only"
      />
      <Checkbox checked={checked} indeterminate={indeterminate} />
    </label>
  );
}

function FacetRow({
  option,
  checked,
  mono = false,
  onToggle,
}: {
  option: FacetOption;
  checked: boolean;
  mono?: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      title={`${option.label} · ${option.count}`}
      className="flex h-7 cursor-default items-center gap-2 rounded-[4px] px-1 text-ui text-fg-body hover:bg-surface/60"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        data-facet-row="true"
        className="peer sr-only"
      />
      <Checkbox checked={checked} />
      <span
        className={cx("min-w-0 flex-1 truncate", mono && "font-mono text-meta")}
      >
        {option.label}
      </span>
      <span className="tabular font-mono text-micro text-fg-faint">
        {option.count}
      </span>
    </label>
  );
}

function Checkbox({
  checked,
  indeterminate = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors peer-focus-visible:outline-1 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent/45",
        checked || indeterminate
          ? "border-accent bg-accent text-canvas"
          : "border-line-strong text-transparent",
      )}
    >
      {indeterminate ? (
        <Minus className="size-2.5" strokeWidth={3} />
      ) : (
        <Check className="size-2.5" strokeWidth={3} />
      )}
    </span>
  );
}
