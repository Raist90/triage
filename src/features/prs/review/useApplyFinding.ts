import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { applyFindingPatch, describeError } from "../../../lib/api";
import type { ActionView, ReviewFinding } from "../../../lib/types";

export type FindingApplyFailure = {
  id: string;
  message: string;
};

export type FindingApplyState = {
  applying: string | null;
  failure: FindingApplyFailure | null;
  apply: (finding: ReviewFinding) => Promise<void>;
};

/**
 * Applies one finding patch at a time. The server serialises applies too; the
 * local id only disables the button so two clicks cannot queue up.
 */
export function useApplyFinding(
  repo: string,
  number: number,
  action: ActionView | null,
): FindingApplyState {
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState<string | null>(null);
  const [failure, setFailure] = useState<FindingApplyFailure | null>(null);

  const apply = useCallback(
    async (finding: ReviewFinding) => {
      if (!action) return;
      setApplying(finding.id);
      setFailure(null);
      try {
        await applyFindingPatch({
          repo,
          number,
          actionID: action.id,
          findingID: finding.id,
        });
        // The artifact on disk now carries appliedAt. Refetch so a reload and
        // the current page agree.
        await queryClient.invalidateQueries({
          queryKey: ["pr-action", repo, number, action.id],
        });
      } catch (caught) {
        setFailure({ id: finding.id, message: describeError(caught) });
      } finally {
        setApplying(null);
      }
    },
    [action, queryClient, repo, number],
  );

  return { applying, failure, apply };
}
