import { EyeOff, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StatusIcon } from "../../../components/StatusBadge";
import { Button, IconButton } from "../../../components/ui";
import { cx } from "../../../lib/cx";
import type { CheckState, PR } from "../../../lib/types";
import type { DiffSelection } from "./diffSelection";

type DiffStripProps = {
  pr: PR;
  selection: DiffSelection;
  showComments: boolean;
  onToggleComments: () => void;
  hideCosmetic: boolean;
  /** Bumped by `/`; opens the popover without owning its state here. */
  openRequest: number;
  onToggleHideCosmetic: () => void;
  /** Rendered next to the Files trigger; receives the close callback. */
  renderFilesPopover: (close: () => void) => ReactNode;
};

function Dot() {
  return (
    <span
      aria-hidden="true"
      className="size-0.5 shrink-0 rounded-full bg-line-strong"
    />
  );
}

/**
 * The one band between Context and code. It owns every PR-level diff fact and
 * the view controls; no second toolbar exists below it.
 */
export function DiffStrip({
  pr,
  selection,
  showComments,
  onToggleComments,
  hideCosmetic,
  openRequest,
  onToggleHideCosmetic,
  renderFilesPopover,
}: DiffStripProps) {
  const [open, setOpen] = useState(false);
  const lastOpenRequest = useRef(openRequest);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openRequest === lastOpenRequest.current) return;
    lastOpenRequest.current = openRequest;
    setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const checks = pr.checkStatus as CheckState;
  const showChecks = checks !== "none";

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-y border-line bg-surface/50 px-6">
      <p className="flex min-w-0 items-center gap-2 overflow-hidden font-mono text-micro whitespace-nowrap text-fg-muted tabular-nums">
        {pr.changedFiles > 0 ? (
          <span>
            {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
          </span>
        ) : null}
        {pr.changedFiles > 0 ? <Dot /> : null}
        <span>
          <span className="text-accent">+{pr.additions}</span>{" "}
          <span className="text-danger">−{pr.deletions}</span>
        </span>
        {pr.commitCount > 0 ? (
          <>
            <Dot />
            <span>
              {pr.commitCount} {pr.commitCount === 1 ? "commit" : "commits"}
            </span>
          </>
        ) : null}
        {showChecks ? (
          <>
            <Dot />
            <StatusIcon kind="check" state={checks} withLabel />
          </>
        ) : null}
        {pr.headSHA ? (
          <>
            <Dot />
            <span className="text-fg-faint">{pr.headSHA.slice(0, 7)}</span>
          </>
        ) : null}
      </p>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {selection.cosmeticFiles > 0 ? (
          <IconButton
            label="Hide cosmetic-only files"
            active={hideCosmetic}
            onClick={onToggleHideCosmetic}
          >
            <EyeOff className="size-4" aria-hidden />
          </IconButton>
        ) : null}
        <IconButton
          label={showComments ? "Hide inline comments" : "Show inline comments"}
          active={showComments}
          onClick={onToggleComments}
        >
          <MessageSquare className="size-4" aria-hidden />
        </IconButton>
        <div ref={wrapRef} className="relative">
          <Button
            variant="ghost"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className={cx(open && "bg-surface text-fg")}
          >
            Files
            <span className="font-mono text-micro text-fg-faint tabular-nums">
              {selection.visible.length}
            </span>
          </Button>
          {open ? renderFilesPopover(() => setOpen(false)) : null}
        </div>
      </div>
    </div>
  );
}
