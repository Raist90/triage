import {
  useCallback,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

type UsePRListCursorOptions = {
  /** Number of rows currently rendered inside the scroll container. */
  count: number;
  /** Scroll container whose direct children are the rows. */
  scrollRef: RefObject<HTMLElement | null>;
  onPick: (index: number) => void;
  onSearch: () => void;
  onToggleFilters: () => void;
  onDismiss: () => void;
};

/**
 * Keyboard cursor for the PR list. The cursor is an index rather than a DOM
 * focus so rows stay simple; the owning element keeps focus and the row is
 * scrolled into view when the cursor moves.
 *
 * `onKeyDown` must be attached to the element that holds focus. Keys coming
 * from a control inside that element (the empty state's action) are left alone.
 */
export function usePRListCursor({
  count,
  scrollRef,
  onPick,
  onSearch,
  onToggleFilters,
  onDismiss,
}: UsePRListCursorOptions) {
  const [cursorState, setCursorState] = useState(0);
  // A shorter list after a refetch or filter change must not leave the cursor
  // out of bounds.
  const lastIndex = Math.max(count - 1, 0);
  const cursor = Math.min(cursorState, lastIndex);

  const move = useCallback(
    (index: number) => {
      if (count === 0) return;
      const next = Math.min(Math.max(index, 0), lastIndex);
      setCursorState(next);
      const row = scrollRef.current?.children[next];
      if (row instanceof HTMLElement) {
        row.scrollIntoView({ block: "nearest" });
      }
    },
    [count, lastIndex, scrollRef],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // The empty state's Clear button owns Enter and Space while focused.
      if (event.target !== event.currentTarget) return;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(cursor + 1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(cursor - 1);
          break;
        case "Enter":
          event.preventDefault();
          onPick(cursor);
          break;
        case "Escape":
          event.preventDefault();
          onDismiss();
          break;
        case "/":
          event.preventDefault();
          onSearch();
          break;
        case "f":
          event.preventDefault();
          onToggleFilters();
          break;
        default:
          break;
      }
    },
    [cursor, move, onDismiss, onPick, onSearch, onToggleFilters],
  );

  return { cursor, handleKeyDown };
}
