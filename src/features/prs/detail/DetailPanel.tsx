import { useRef, type ReactNode } from "react";
import { cx } from "../../../lib/cx";
import { scrollEdgeClass, useScrollEdges } from "../../../lib/useScrollEdges";
import type { DetailTab } from "./DetailTabs";

type DetailPanelProps = {
  activeTab: DetailTab;
  children: ReactNode;
};

/**
 * The scrolling tab body. It owns the ref so the scroll-edge hook mounts with
 * the node instead of during the skeleton, when the panel does not exist yet.
 */
export function DetailPanel({ activeTab, children }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollEdges = useScrollEdges(panelRef);

  return (
    <div
      ref={panelRef}
      role="tabpanel"
      id={`detail-panel-${activeTab}`}
      aria-labelledby={`detail-tab-${activeTab}`}
      tabIndex={0}
      className={cx(
        activeTab === "diff"
          ? "flex min-h-0 flex-1 flex-col outline-none"
          : "min-h-0 flex-1 overflow-y-auto p-4 outline-none",
        scrollEdgeClass(scrollEdges),
      )}
    >
      {children}
    </div>
  );
}
