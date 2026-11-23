import { useQuery } from "@tanstack/react-query";
import { GitPullRequest } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { ConnectionState } from "./components/ConnectionStatus";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { LoadingState } from "./components/LoadingState";
import { Rail } from "./components/Rail";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar, type ConfigStatus } from "./components/Sidebar";
import { StateView } from "./components/StateView";
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

  // The window controls live in the sidebar header. Panes that reach the
  // window's left edge have to start their 44px band after the lights.
  const chromeLead = detailFullscreen ? 112 : sidebarOpen ? 0 : 60;

  return (
    <div
      className="relative flex h-full overflow-hidden bg-canvas text-fg"
      style={{ "--chrome-lead": `${chromeLead}px` } as CSSProperties}
    >
      {/* One light source behind the main panes; opaque chrome covers it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 ambient-wash"
      />

      {/* One seam under the whole 44px chrome band. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-11 z-10 h-px app-seam"
      />

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
            "min-w-0 flex-col cockpit:w-85 cockpit:shrink-0 cockpit:border-r cockpit:border-line",
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
            "min-w-0 flex-1 flex-col",
            prSelection ? "flex" : "hidden cockpit:flex",
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
    <StateView
      dotGrid
      icon={GitPullRequest}
      title="Pick a pull request"
      description="Read the conversation, scan the diff, or run a review."
      hints={[
        { keys: ["j", "k"], label: "move · open" },
        { keys: ["/"], label: "search" },
      ]}
    />
  );
}
