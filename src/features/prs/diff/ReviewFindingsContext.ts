import { createContext, useContext } from "react";
import type {
  ActionArtifact,
  ReviewDocument,
  ReviewFinding,
} from "../../../lib/types";
import type { FindingApplyFailure } from "../review/useApplyFinding";

/**
 * The review artifact, provided above `DiffView` so every hunk can render the
 * findings that land on its lines without threading the document through the
 * file tree. `review` is undefined while the artifact is stale: a finding from
 * an older head must not anchor silently.
 */
export type ReviewFindingsValue = {
  review?: ReviewDocument;
  artifact?: ActionArtifact;
  stale: boolean;
  applying: string | null;
  applyFailure: FindingApplyFailure | null;
  onApply: (finding: ReviewFinding) => void;
};

const EMPTY: ReviewFindingsValue = {
  stale: false,
  applying: null,
  applyFailure: null,
  onApply: () => {},
};

/** Safe outside a review: DiffView standalone (tests) renders no threads. */
export const ReviewFindingsContext = createContext<ReviewFindingsValue>(EMPTY);

export function useReviewFindings(): ReviewFindingsValue {
  return useContext(ReviewFindingsContext);
}
