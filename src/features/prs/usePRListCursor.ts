import {
  useCallback,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

type UsePRListCursorOptions = {
  /** Rendered row keys in cursor order: hero, then expanded buckets. */
  keys: string[];
  /** Key of the open PR, or null. */
  selectedKey: string | null;
  /** Scroll container that holds the listbox. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Stable DOM id for one row key, used to scroll it into view. */
  optionID: (key: string) => string;
  onOpen: (key: string) => void;
  onSearch: () => void;
  onToggleFilters: () => void;
  onDismiss: () => void;
};

/**
 * Keyed keyboard cursor for the deck. The cursor is independent of selection:
 * j/k only move it, Enter opens. Keys make the cursor survive a refetch even
 * when rows are inserted or removed above it.
 */
export function usePRListCursor({
  keys,
  selectedKey,
  scrollRef,
  optionID,
  onOpen,
  onSearch,
  onToggleFilters,
  onDismiss,
}: UsePRListCursorOptions) {
  const [state, setState] = useState<{ key: string | null; index: number }>({
    key: null,
    index: 0,
  });
  // Resolve the cursor against the current rows. If its row disappeared, clamp
  // to the row now at its old index, then the previous row, then the first.
  let cursorKey: string | null = state.key;
  if (keys.length === 0) {
    cursorKey = null;
  } else if (cursorKey === null) {
    const selectedIndex = selectedKey ? keys.indexOf(selectedKey) : -1;
    cursorKey = selectedIndex >= 0 ? keys[selectedIndex] : keys[0];
  } else if (!keys.includes(cursorKey)) {
    cursorKey = keys[state.index] ?? keys[state.index - 1] ?? keys[0] ?? null;
  }
  const cursorIndex = cursorKey ? keys.indexOf(cursorKey) : -1;

  const move = useCallback(
    (delta: number) => {
      if (keys.length === 0) return;
      const next = Math.min(
        Math.max((cursorIndex < 0 ? 0 : cursorIndex) + delta, 0),
        keys.length - 1,
      );
      if (keys[next] === cursorKey) return;
      const key = keys[next];
      setState({ key, index: next });
      const row = document.getElementById(optionID(key));
      row?.scrollIntoView({ block: "nearest" });
    },
    [cursorIndex, cursorKey, keys, optionID],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // A control inside the listbox (bucket head, hero action) owns its keys.
      if (event.target !== event.currentTarget) return;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "Enter":
          if (!cursorKey) return;
          event.preventDefault();
          onOpen(cursorKey);
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
    [cursorKey, move, onDismiss, onOpen, onSearch, onToggleFilters],
  );

  // `scrollRef` is part of the contract even though ids locate the row, so the
  // caller can keep focus on the listbox.
  void scrollRef;

  return { cursorKey, handleKeyDown };
}
