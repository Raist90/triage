import { createContext, useContext } from "react";
import type { PR } from "../../../lib/types";
import type { PRMutationController } from "./usePRMutations";
import type { ReviewController } from "./useReview";

/**
 * The open pull request and the controllers its chrome shares. Scoped to
 * `PRDetailBody`, which remounts per PR, so nothing here can leak from one
 * pull request into the next.
 *
 * Deliberately not part of this value: action run state (`useClaudeAction`)
 * and the diff. Those belong to the tab that runs or renders them.
 */
export type PRDetailValue = {
  repo: string;
  number: number;
  pr?: PR;
  mutations: PRMutationController;
  review: ReviewController;
};

/** Provided by `PRDetailProvider`, mounted at the root of `PRDetailBody`. */
export const PRDetailContext = createContext<PRDetailValue | null>(null);

export function usePRDetailContext(): PRDetailValue {
  const value = useContext(PRDetailContext);
  if (value === null) {
    throw new Error(
      "usePRDetailContext must be used inside <PRDetailProvider>",
    );
  }
  return value;
}
