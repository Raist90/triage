import type { ReactNode } from "react";
import {
  DiffCommentsContext,
  type DiffCommentsValue,
} from "./DiffCommentsContext";

export function DiffCommentsProvider({
  value,
  children,
}: {
  value: DiffCommentsValue;
  children: ReactNode;
}) {
  return <DiffCommentsContext value={value}>{children}</DiffCommentsContext>;
}
