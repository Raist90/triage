import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { StateView } from "./StateView";

type EmptyStateProps = {
  title: string;
  description: string;
  footnote?: string;
  /** Optional control under the copy, e.g. "Clear filters". */
  action?: ReactNode;
  icon?: LucideIcon;
};

export function EmptyState({
  title,
  description,
  footnote,
  action,
  icon = Inbox,
}: EmptyStateProps) {
  return (
    <StateView
      icon={icon}
      title={title}
      description={description}
      footnote={footnote}
      action={action}
    />
  );
}
