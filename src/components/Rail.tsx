import {
  Eye,
  Layers,
  List,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { Tab } from "../lib/types";
import { cx } from "../lib/cx";

type RailProps = {
  tabs: Tab[];
  activeTabID: string | undefined;
  repoPanelOpen: boolean;
  onSelectTab: (tabID: string) => void;
  onToggleRepoPanel: () => void;
  onOpenSettings: () => void;
};

const TAB_ICON: Record<string, LucideIcon> = {
  mine: UserRound,
  review: Eye,
  all: Layers,
};

export function Rail({
  tabs,
  activeTabID,
  repoPanelOpen,
  onSelectTab,
  onToggleRepoPanel,
  onOpenSettings,
}: RailProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex w-12 shrink-0 flex-col items-center border-r border-line bg-canvas py-2"
    >
      <button
        type="button"
        onClick={onToggleRepoPanel}
        title={repoPanelOpen ? "Hide repositories" : "Show repositories"}
        aria-label={repoPanelOpen ? "Hide repositories" : "Show repositories"}
        aria-expanded={repoPanelOpen}
        className="mb-3 flex size-7 items-center justify-center rounded-[4px] bg-raised font-mono text-meta font-medium text-fg transition-colors hover:bg-line"
      >
        T
      </button>

      <div
        role="tablist"
        aria-label="Pull request filters"
        className="flex flex-col gap-1"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabID;
          const Icon = TAB_ICON[tab.id] ?? List;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={tab.label}
              title={tab.label}
              onClick={() => onSelectTab(tab.id)}
              className={cx(
                "relative flex size-9 items-center justify-center rounded-[4px] transition-colors",
                active
                  ? "bg-surface text-fg before:absolute before:inset-y-2 before:-left-1.5 before:w-0.5 before:rounded-full before:bg-accent"
                  : "text-fg-faint hover:bg-surface hover:text-fg",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          );
        })}
      </div>

      <div className="mt-auto">
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="flex size-9 items-center justify-center rounded-[4px] text-fg-faint transition-colors hover:bg-surface hover:text-fg"
        >
          <Settings className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
