import type { UseQueryResult } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui";
import { describeError } from "../../../lib/api";
import type { PR, PRDiffResponse } from "../../../lib/types";
import { DiffView, type DiffTarget } from "../diff/DiffView";
import type { DiffCommentsController } from "../diff/useDiffComments";

type DiffTabProps = {
  pr: PR;
  prKey: string;
  diffQuery: UseQueryResult<PRDiffResponse, Error>;
  comments: DiffCommentsController;
  focusTarget?: DiffTarget;
};

export function DiffTab({
  pr,
  prKey,
  diffQuery,
  comments,
  focusTarget,
}: DiffTabProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      {diffQuery.isFetching && !diffQuery.isPending ? (
        <div className="mb-2 flex justify-end">
          <RefreshCw
            className="size-3 animate-spin text-fg-faint"
            aria-label="Refreshing diff"
          />
        </div>
      ) : null}

      {diffQuery.isPending ? (
        <div aria-hidden="true" className="m-3 rounded-md border border-line">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="border-b border-line p-3 last:border-b-0"
            >
              <div className="h-3 w-1/2 animate-pulse rounded-sm bg-surface" />
            </div>
          ))}
        </div>
      ) : diffQuery.isError ? (
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
      ) : diffQuery.data && diffQuery.data.files.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DiffView
            key={prKey}
            files={diffQuery.data.files}
            semanticAvailable={diffQuery.data.semanticAvailable}
            semanticSummary={diffQuery.data.semanticSummary}
            comments={comments}
            headSHA={pr.headSHA}
            canComment={pr.state === "open" && pr.headSHA !== ""}
            viewerLogin={pr.viewerLogin}
            focusTarget={focusTarget}
          />
        </div>
      ) : (
        <p className="p-4 text-meta text-fg-faint">No file changes.</p>
      )}
    </section>
  );
}
