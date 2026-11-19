import type { ReactNode } from "react";
import { PRDetailContext, type PRDetailValue } from "./PRDetailContext";

export function PRDetailProvider({
  value,
  children,
}: {
  value: PRDetailValue;
  children: ReactNode;
}) {
  return <PRDetailContext value={value}>{children}</PRDetailContext>;
}
