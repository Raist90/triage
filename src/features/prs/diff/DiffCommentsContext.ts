import { createContext, useContext } from "react";
import type { DiffCommentsController } from "./useDiffComments";

/**
 * The review surface of one pull request: the inline-comment controller and
 * the facts a comment anchors to. It is constant for the diff's lifetime, so
 * sections, hunks, rows and the composer read it here instead of receiving it
 * through four levels of props.
 *
 * Deliberately not part of this value: `draft`, `flash` and `open`. Those
 * change per interaction, and only the owning section may re-render for them.
 */
export type DiffCommentsValue = {
  comments: DiffCommentsController;
  headSHA: string;
  canComment: boolean;
  viewerLogin?: string;
};

/** Provided by `DiffCommentsProvider`, mounted at the root of `DiffView`. */
export const DiffCommentsContext = createContext<DiffCommentsValue | null>(
  null,
);

export function useDiffCommentsContext(): DiffCommentsValue {
  const value = useContext(DiffCommentsContext);
  if (value === null) {
    throw new Error(
      "useDiffCommentsContext must be used inside <DiffCommentsProvider>",
    );
  }
  return value;
}
