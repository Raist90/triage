import { Button } from "../../../components/ui";
import { usePRDetail } from "./PRDetailContext";

/** Confirmation bar or a failed action, rendered below the detail bar. */
export function PRStatePanel() {
  const { pr, mutations } = usePRDetail();
  if (mutations.confirming === "merge") {
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
        <PanelError error={mutations.error} />
      </section>
    );
  }

  if (mutations.confirming === "close") {
    return (
      <section
        aria-label="Confirm close pull request"
        className="shrink-0 border-b border-line px-4 py-3"
      >
        <p className="text-ui text-fg">
          Close <span className="font-mono text-fg-muted">#{pr.number}</span>{" "}
          without merging?
        </p>
        <p className="mt-1 text-meta text-fg-faint">
          The branch is kept. You can reopen it on GitHub.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="outline"
            onClick={mutations.close}
            disabled={mutations.pending}
          >
            {mutations.submitting === "close"
              ? "Closing…"
              : "Close pull request"}
          </Button>
          <Button
            variant="ghost"
            onClick={mutations.closeConfirm}
            disabled={mutations.pending}
          >
            Cancel
          </Button>
        </div>
        <PanelError error={mutations.error} />
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

function PanelError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-meta text-danger">
      {error}
    </p>
  );
}
