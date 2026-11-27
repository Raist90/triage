import type { ReactNode } from "react";

/**
 * Frame for anything rendered under a diff line (comment thread, composer,
 * finding). The patch is one horizontally scrolling `min-w-max` block, so a
 * thread in normal flow would be as wide as the longest code line: its text
 * would run off the pane and force a sideways scroll to read. `100cqw` pins the
 * frame to the patch's scrollport (the scroll container is the query
 * container) and `sticky left-0` keeps it in view while the code scrolls under
 * it. The content inside still caps itself at a readable measure.
 */
export function DiffThread({ children }: { children: ReactNode }) {
  return (
    <div className="sticky left-0 w-[100cqw] border-b border-line bg-surface">
      {children}
    </div>
  );
}
