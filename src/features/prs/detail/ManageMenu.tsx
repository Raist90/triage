import {
  Check,
  CircleX,
  FilePenLine,
  GitMerge,
  MessageSquare,
  MoreHorizontal,
  Send,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../../../lib/cx";
import { useOverlaySide } from "../../../lib/useOverlaySide";
import { useUIStore } from "../../../stores/ui";
import type { PR } from "../../../lib/types";
import {
  canManagePR,
  mergeBlocker,
  type MergeBlocker,
  type PRMutationController,
} from "./usePRMutations";
import { canApprove, canReview, type ReviewController } from "./useReview";

const BLOCKER_NOTE: Record<Exclude<MergeBlocker, null>, string> = {
  disabled: "Squash merge is disabled for this repository.",
  draft: "Merge blocked while the pull request is a draft.",
  conflict: "Merge blocked by conflicts.",
  blocked: "Merge blocked by branch protection.",
  unknown: "Checking mergeability…",
};

/**
 * Hand-rolled popover, following `PRFilterPopover`: no new dependency, outside
 * click and Escape close it, Escape is handled in capture so it never reaches
 * the pane's own precedence chain.
 */
export function ManageMenu({
  pr,
  review,
  mutations,
}: {
  pr: PR;
  review: ReviewController;
  mutations: PRMutationController;
}) {
  const [open, setOpen] = useState(false);
  const setReviewBarOpen = useUIStore((state) => state.setReviewBarOpen);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const placement = useOverlaySide({
    anchorRef: wrapRef,
    panelRef: menuRef,
    open,
  });

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const reviewable = canReview(pr);
  const manageable = canManagePR(pr);
  if (!reviewable && !manageable) return null;

  const blocker = mergeBlocker(pr);
  const close = () => setOpen(false);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-meta text-fg-muted transition-colors hover:bg-surface hover:text-fg"
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
        Manage
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Manage pull request"
          style={{ maxHeight: placement.maxHeight }}
          className={cx(
            "absolute right-0 z-30 w-60 surface-in overflow-y-auto rounded-md border border-line-strong elevated p-1",
            placement.side === "up" ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {reviewable ? (
            <>
              {pr.viewerReview === "approved" ? (
                <MenuItem disabled icon={<Check className="size-3.5" />}>
                  Approved
                </MenuItem>
              ) : canApprove(pr) ? (
                <MenuItem
                  icon={<Check className="size-3.5" />}
                  disabled={review.pending}
                  onClick={() => {
                    review.submit("APPROVE", "");
                    close();
                  }}
                >
                  Approve pull request
                </MenuItem>
              ) : null}
              <MenuItem
                icon={<MessageSquare className="size-3.5" />}
                disabled={review.pending}
                onClick={() => {
                  // Below the wide breakpoint the form lives in a hidden bar;
                  // opening it must also reveal the bar.
                  setReviewBarOpen(true);
                  review.openPanel();
                  close();
                }}
              >
                Request changes…
              </MenuItem>
            </>
          ) : null}

          {manageable ? (
            <>
              {reviewable ? (
                <span aria-hidden="true" className="my-1 block h-px bg-line" />
              ) : null}
              <MenuItem
                icon={
                  pr.isDraft ? (
                    <Send className="size-3.5" />
                  ) : (
                    <FilePenLine className="size-3.5" />
                  )
                }
                disabled={mutations.pending}
                onClick={() => {
                  mutations.toggleDraft(!pr.isDraft);
                  close();
                }}
              >
                {pr.isDraft ? "Ready for review" : "Convert to draft"}
              </MenuItem>
              <MenuItem
                icon={<CircleX className="size-3.5" />}
                danger
                disabled={mutations.pending}
                onClick={() => {
                  mutations.openCloseConfirm();
                  close();
                }}
              >
                Close pull request
              </MenuItem>
              <MenuItem
                icon={<GitMerge className="size-3.5" />}
                disabled={mutations.pending || blocker !== null}
                title={blocker ? BLOCKER_NOTE[blocker] : "Squash merge"}
                onClick={() => {
                  mutations.openMergeConfirm();
                  close();
                }}
              >
                Squash merge
              </MenuItem>
              {blocker ? (
                <p className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-micro text-fg-faint">
                  {BLOCKER_NOTE[blocker]}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  danger = false,
  disabled = false,
  title,
  onClick,
  children,
}: {
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-meta transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        danger
          ? "text-danger hover:bg-surface"
          : "text-fg-muted hover:bg-surface hover:text-fg",
      )}
    >
      <span className={cx(danger ? "text-danger" : "text-fg-faint")}>
        {icon}
      </span>
      {children}
    </button>
  );
}
