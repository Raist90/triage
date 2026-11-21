import type { WalkthroughStep } from "../../../../lib/types";
import { SidebarRow } from "./SidebarRow";

/** One synthetic commit: subject, scope and size, with the path's order. */
export function StepRow({
  index,
  active,
  onSelect,
  step,
}: {
  index: number;
  active: boolean;
  onSelect: () => void;
  step: WalkthroughStep;
}) {
  return (
    <SidebarRow
      active={active}
      current="step"
      onSelect={onSelect}
      title={`${step.title} · ${step.files.length} files`}
      className="flex flex-col gap-0.5 p-2"
    >
      <span className="flex w-full min-w-0 items-baseline gap-2">
        <span className="w-3 shrink-0 font-mono text-micro text-fg-faint tabular-nums">
          {index + 1}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-meta ${
            active ? "text-fg" : "text-fg-body"
          }`}
        >
          {step.title}
        </span>
      </span>
      <span className="flex items-center gap-2 pl-5 font-mono text-micro text-fg-faint tabular-nums">
        <span>
          {step.files.length} {step.files.length === 1 ? "file" : "files"}
        </span>
        <span className="text-accent/80">+{step.additions}</span>
        <span className="px-1 text-line-strong">/</span>
        <span>−{step.deletions}</span>
      </span>
    </SidebarRow>
  );
}
