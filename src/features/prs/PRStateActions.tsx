import { FilePenLine, GitMerge, Send } from "lucide-react";
import { Button } from "../../components/ui";
import type { PR } from "../../lib/types";
import {
  canManagePR,
  mergeBlocker,
  type PRMutationController,
} from "./usePRMutations";

type PRStateActionsProps = {
  pr: PR;
  mutations: PRMutationController;
};

const BLOCKER_TITLE: Record<
  Exclude<ReturnType<typeof mergeBlocker>, null>,
  string
> = {
  draft: "Mark the pull request ready for review first",
  conflict: "Resolve the merge conflicts first",
  blocked: "GitHub blocks this merge",
  unknown: "Checking mergeability…",
  disabled: "Squash merge is disabled for this repository",
};

/** Draft toggle and squash merge for your own open PR. */
export function PRStateActions({ pr, mutations }: PRStateActionsProps) {
  if (!canManagePR(pr)) return null;

  const blocker = mergeBlocker(pr);
  const merging = mutations.submitting === "merge";

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        variant="outline"
        onClick={() => mutations.toggleDraft(!pr.isDraft)}
        disabled={mutations.pending}
        aria-label={pr.isDraft ? "Ready for review" : "Convert to draft"}
        title={
          pr.isDraft
            ? "Mark this pull request ready for review"
            : "Convert this pull request back to a draft"
        }
      >
        {pr.isDraft ? (
          <Send className="size-4" aria-hidden />
        ) : (
          <FilePenLine className="size-4" aria-hidden />
        )}
        <span className="hidden min-[1280px]:inline">
          {mutations.submitting === "draft"
            ? "Updating…"
            : pr.isDraft
              ? "Ready for review"
              : "Convert to draft"}
        </span>
      </Button>

      <Button
        variant="primary"
        onClick={mutations.openConfirm}
        disabled={mutations.pending || blocker !== null}
        title={
          blocker ? BLOCKER_TITLE[blocker] : "Squash merge this pull request"
        }
      >
        <GitMerge className="size-4" aria-hidden />
        {merging ? "Merging…" : "Squash merge"}
      </Button>
    </div>
  );
}

/** Confirmation bar or a failed action, rendered below the detail bar. */
export function PRStatePanel({ pr, mutations }: PRStateActionsProps) {
  if (mutations.confirmOpen) {
    return (
      <section
        aria-label="Confirm squash merge"
        className="shrink-0 border-b border-line px-4 py-3"
      >
        <p className="text-ui text-fg">
          Squash merge{" "}
          <span className="font-mono text-fg-muted">#{pr.number}</span> into{" "}
          <span className="font-mono text-fg-muted">{pr.baseBranch}</span>?
        </p>
        <p className="mt-1 font-mono text-meta text-fg-faint">
          {pr.headSHA.slice(0, 7)}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => mutations.merge(pr.headSHA)}
            disabled={mutations.pending}
          >
            {mutations.submitting === "merge" ? "Merging…" : "Squash merge"}
          </Button>
          <Button
            variant="ghost"
            onClick={mutations.closeConfirm}
            disabled={mutations.pending}
          >
            Cancel
          </Button>
        </div>
        {mutations.error ? (
          <p role="alert" className="mt-2 text-meta text-danger">
            {mutations.error}
          </p>
        ) : null}
      </section>
    );
  }

  if (!mutations.error) return null;

  return (
    <div
      role="alert"
      className="shrink-0 border-b border-line px-4 py-2 text-meta text-danger"
    >
      {mutations.error}
    </div>
  );
}
