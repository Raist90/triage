import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { ConnectionState } from "./components/ConnectionStatus";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { LoadingState } from "./components/LoadingState";
import { Rail } from "./components/Rail";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar, type ConfigStatus } from "./components/Sidebar";
import { Kbd } from "./components/ui";
import { cx } from "./lib/cx";
import { describeError, getConfig, getHealth } from "./lib/api";
import { parsePRKey } from "./lib/pr";
import { PRDetail } from "./features/prs/PRDetail";
import { PRList } from "./features/prs/PRList";
import { useUIStore } from "./stores/ui";

export function App() {
  const configQuery = useQuery({ queryKey: ["config"], queryFn: getConfig });
  const healthQuery = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedRepo = useUIStore((state) => state.selectedRepo);
  const selectRepo = useUIStore((state) => state.selectRepo);
  const activeTabID = useUIStore((state) => state.activeTabID);
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const selectedPR = useUIStore((state) => state.selectedPR);
  const detailOpen = useUIStore((state) => state.detailOpen);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const detailFullscreen = useUIStore((state) => state.detailFullscreen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const prSelection = detailOpen && selectedPR ? parsePRKey(selectedPR) : null;

  const tabs = configQuery.data?.tabs ?? [];
  const activeTab = tabs.find((tab) => tab.id === activeTabID) ?? tabs[0];

  const configStatus: ConfigStatus = configQuery.isPending
    ? "loading"
    : configQuery.isError
      ? "error"
      : "ready";

  const connection: ConnectionState = healthQuery.isPending
    ? "connecting"
    : healthQuery.isError
      ? "disconnected"
      : "connected";

  function retryConnection() {
    void configQuery.refetch();
    void healthQuery.refetch();
  }

  let content: ReactNode;
  if (configQuery.isPending) {
    content = <LoadingState label="Loading workspace…" />;
  } else if (configQuery.isError) {
    content = (
      <ErrorState
        message={describeError(configQuery.error)}
        retrying={configQuery.isFetching}
        onRetry={retryConnection}
      />
    );
  } else if (!activeTab) {
    content = (
      <EmptyState
        title="No tabs configured"
        description="The Triage server returned config without any PR tabs."
      />
    );
  } else if (configQuery.data.repos.length === 0) {
    content = (
      <EmptyState
        title="No repositories configured"
        description={`Add owner/name entries to ${configQuery.data.configPath}, then restart Triage.`}
      />
    );
  } else {
    content = (
      <PRList
        key={`${selectedRepo ?? ""}:${activeTab.id}`}
        tabID={activeTab.id}
        tabLabel={activeTab.label}
        repo={selectedRepo}
      />
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-canvas text-fg">
      {detailFullscreen ? null : (
        <Rail
          tabs={tabs}
          activeTabID={activeTab?.id}
          repoPanelOpen={sidebarOpen}
          onSelectTab={setActiveTab}
          onToggleRepoPanel={toggleSidebar}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {sidebarOpen && !detailFullscreen ? (
        <Sidebar
          connection={connection}
          configStatus={configStatus}
          repos={configQuery.data?.repos ?? []}
          selectedRepo={selectedRepo}
          user={configQuery.data?.user.login}
          onSelectRepo={selectRepo}
          onRetryConfig={retryConnection}
          onCollapse={toggleSidebar}
        />
      ) : null}

      <main className="flex min-w-0 flex-1">
        <section
          aria-hidden={detailFullscreen || undefined}
          className={cx(
            "min-w-0 flex-col cockpit:w-[340px] cockpit:shrink-0 cockpit:border-r cockpit:border-line",
            detailFullscreen
              ? // Hidden, not unmounted: the list keeps its cursor and scroll
                // for when fullscreen exits.
                "hidden"
              : prSelection
                ? "hidden cockpit:flex"
                : "flex flex-1 cockpit:flex-none",
          )}
        >
          {/* The list stays mounted so its cursor and scroll survive a detail visit. */}
          <div className="flex h-full min-h-0 flex-1 flex-col">{content}</div>
        </section>

        <section
          className={cx(
            "min-w-0 flex-1",
            prSelection ? "flex flex-col" : "hidden cockpit:flex",
          )}
        >
          {prSelection ? (
            <PRDetail repo={prSelection.repo} number={prSelection.number} />
          ) : (
            <DetailPlaceholder />
          )}
        </section>
      </main>

      <SettingsDialog
        open={settingsOpen}
        config={configQuery.data}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function DetailPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-ui text-fg-muted">
        Pick a pull request to read the diff.
      </p>
      <div className="flex items-center gap-3 text-meta text-fg-faint">
        <span className="flex items-center gap-2">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd>
          move
        </span>
        <span className="flex items-center gap-2">
          <Kbd>↵</Kbd>
          open
        </span>
        <span className="flex items-center gap-2">
          <Kbd>/</Kbd>
          filter files
        </span>
      </div>
    </div>
  );
}
