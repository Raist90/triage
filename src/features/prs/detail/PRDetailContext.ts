import { createContext, useContext } from "react";
import type { PR } from "../../../lib/types";
import type { PRMutationController } from "./usePRMutations";
import type { ReviewController } from "./useReview";

/**
 * The loaded pull request and the controllers the detail pane shares. Mounted
 * only where a PR exists, so `pr` is not optional and consumers never re-check
 * it. Scoped to `PRDetailBody`, which remounts per PR, so nothing here can
 * leak from one pull request into the next.
 *
 * Deliberately not part of this value: action run state (`useClaudeAction`)
 * and the diff. Those belong to the tab that runs or renders them.
 */
export type PRDetailValue = {
  pr: PR;
  mutations: PRMutationController;
  review: ReviewController;
};

export const PRDetailContext = createContext<PRDetailValue | null>(null);

export function usePRDetail(): PRDetailValue {
  const value = useContext(PRDetailContext);
  if (value === null) {
    throw new Error("usePRDetail must be used inside <PRDetailContext>");
  }
  return value;
}
