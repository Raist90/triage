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
      data-tauri-drag-region
      className="flex w-16 shrink-0 flex-col items-center border-r border-line bg-canvas pt-11 pb-2"
    >
      <button
        type="button"
        onClick={onToggleRepoPanel}
        title={repoPanelOpen ? "Hide repositories" : "Show repositories"}
        aria-label={repoPanelOpen ? "Hide repositories" : "Show repositories"}
        aria-expanded={repoPanelOpen}
        className="mb-3 flex size-7 items-center justify-center rounded-sm lit font-mono text-meta font-medium text-fg transition-colors hover:brightness-110"
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
                "relative flex size-9 items-center justify-center rounded-sm transition-colors",
                active
                  ? "rail-active text-fg"
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
          className="flex size-9 items-center justify-center rounded-sm text-fg-faint transition-colors hover:bg-surface hover:text-fg"
        >
          <Settings className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
