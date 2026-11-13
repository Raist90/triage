import { ChevronsLeft } from "lucide-react";
import type { RepoView } from "../lib/types";
import { ConnectionStatus, type ConnectionState } from "./ConnectionStatus";
import { RepoFilter } from "./RepoFilter";
import { Button, MicroLabel } from "./ui";

export type ConfigStatus = "loading" | "error" | "ready";

type SidebarProps = {
  connection: ConnectionState;
  configStatus: ConfigStatus;
  repos: RepoView[];
  selectedRepo: string | null;
  user?: string;
  onSelectRepo: (repo: string | null) => void;
  onRetryConfig: () => void;
  onCollapse: () => void;
};

export function Sidebar({
  connection,
  configStatus,
  repos,
  selectedRepo,
  user,
  onSelectRepo,
  onRetryConfig,
  onCollapse,
}: SidebarProps) {
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-canvas">
      <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-3">
        <MicroLabel>Repositories</MicroLabel>
        <button
          type="button"
          onClick={onCollapse}
          title="Hide repositories"
          aria-label="Hide repositories"
          className="flex size-7 items-center justify-center rounded-[4px] text-fg-faint transition-colors hover:bg-surface hover:text-fg"
        >
          <ChevronsLeft className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {configStatus === "loading" ? (
          <div className="flex flex-col gap-1 pt-1">
            {[72, 56, 64, 48].map((width) => (
              <div
                key={width}
                className="h-7 animate-pulse rounded-[4px] bg-surface"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        ) : null}

        {configStatus === "error" ? (
          <div className="px-2 py-2">
            <p className="text-meta text-fg-faint">Config unavailable.</p>
            <Button
              variant="ghost"
              onClick={onRetryConfig}
              className="mt-1 px-0 text-accent hover:bg-transparent"
            >
              Retry
            </Button>
          </div>
        ) : null}

        {configStatus === "ready" ? (
          <RepoFilter
            repos={repos}
            selectedRepo={selectedRepo}
            onSelect={onSelectRepo}
          />
        ) : null}
      </div>

      <div className="flex h-11 shrink-0 items-center justify-between border-t border-line px-3">
        <span className="truncate font-mono text-meta text-fg-faint">
          {user ? `@${user}` : ""}
        </span>
        <ConnectionStatus state={connection} />
      </div>
    </aside>
  );
}
