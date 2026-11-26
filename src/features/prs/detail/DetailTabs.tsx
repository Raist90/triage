export type DetailTab =
  "preflight" | "conversation" | "diff" | "review" | "explain";

export type TabDef = {
  id: DetailTab;
  label: string;
  count?: number;
};

type DetailTabsProps = {
  tabs: TabDef[];
  active: DetailTab;
  onSelect: (tab: DetailTab) => void;
};

export function DetailTabs({ tabs, active, onSelect }: DetailTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Pull request sections"
      className="flex h-9 shrink-0 gap-4 border-b border-line px-4"
    >
      {tabs.map((item) => {
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`detail-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`detail-panel-${item.id}`}
            onClick={() => onSelect(item.id)}
            className={
              selected
                ? "relative -mb-px flex items-center gap-2 text-meta font-medium text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:accent-hairline"
                : "-mb-px flex items-center gap-2 border-b border-transparent text-meta text-fg-faint transition-colors hover:text-fg-muted"
            }
          >
            {item.label}
            {typeof item.count === "number" && item.count > 0 ? (
              <span className="font-mono text-fg-faint tabular-nums">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
