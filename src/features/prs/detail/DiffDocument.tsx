import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "../../../components/ui";
import { describeError } from "../../../lib/api";
import type { PR, PRDiffResponse } from "../../../lib/types";
import type { DiffCommentsController } from "../diff/useDiffComments";
import { DiffView, type DiffTarget } from "../diff/DiffView";

/** The loaded document's code half: strip, one scroll and every file. */
export function DiffDocument({
  pr,
  prKey,
  diffQuery,
  comments,
  focusTarget,
}: {
  pr: PR;
  prKey: string;
  diffQuery: UseQueryResult<PRDiffResponse, Error>;
  comments: DiffCommentsController;
  focusTarget?: DiffTarget;
}) {
  if (diffQuery.isPending) {
    return (
      <div aria-hidden="true" className="m-3 rounded-md border border-line">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="border-b border-line p-3 last:border-b-0">
            <div className="h-3 w-1/2 shimmer rounded-sm" />
          </div>
        ))}
      </div>
    );
  }

  if (diffQuery.isError) {
    return (
      <div
        role="alert"
        className="m-3 rounded-md border border-line p-3 text-meta text-fg-faint"
      >
        <p className="text-fg-muted">Can’t load the diff.</p>
        <p className="mt-1">{describeError(diffQuery.error)}</p>
        <Button
          variant="outline"
          onClick={() => void diffQuery.refetch()}
          disabled={diffQuery.isFetching}
          className="mt-2"
        >
          {diffQuery.isFetching ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );
  }

  if (!diffQuery.data || diffQuery.data.files.length === 0) {
    return <p className="p-4 text-meta text-fg-faint">No file changes.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DiffView
        key={prKey}
        pr={pr}
        files={diffQuery.data.files}
        semanticAvailable={diffQuery.data.semanticAvailable}
        walkthrough={diffQuery.data.walkthrough}
        comments={comments}
        headSHA={pr.headSHA}
        canComment={pr.state === "open" && pr.headSHA !== ""}
        viewerLogin={pr.viewerLogin}
        focusTarget={focusTarget}
      />
    </div>
  );
}
