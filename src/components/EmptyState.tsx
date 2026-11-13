import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  footnote?: string;
  /** Optional control under the copy, e.g. "Clear filters". */
  action?: ReactNode;
};

export function EmptyState({
  title,
  description,
  footnote,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Inbox className="size-5 text-fg-faint" aria-hidden />
      <p className="text-ui text-fg">{title}</p>
      <p className="max-w-sm text-meta text-fg-faint">{description}</p>
      {footnote ? (
        <p className="max-w-sm text-meta text-fg-faint">{footnote}</p>
      ) : null}
      {action}
    </div>
  );
}
