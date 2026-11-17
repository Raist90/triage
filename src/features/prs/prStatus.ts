import type { PR } from "../../lib/types";

export type PRStatus = "open" | "draft" | "merged" | "closed";

export function prStatus(pr: Pick<PR, "state" | "isDraft">): PRStatus {
  if (pr.state === "merged") return "merged";
  if (pr.state === "closed") return "closed";
  return pr.isDraft ? "draft" : "open";
}
