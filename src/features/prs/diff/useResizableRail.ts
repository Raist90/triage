import { useEffect, useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useUIStore } from "../../../stores/ui";

export const DEFAULT_WIDTH = 208;
export const MIN_WIDTH = 168;
export const MAX_WIDTH = 440;

type DragState = {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  bodyCursor: string;
  bodyUserSelect: string;
};

function restoreBodyStyles(drag: DragState) {
  document.body.style.cursor = drag.bodyCursor;
  document.body.style.userSelect = drag.bodyUserSelect;
}

/**
 * Resizes the diff file rail. Width is committed to the store on drag end and
 * on every keyboard step; during a pointer drag only the `--diff-rail` custom
 * property changes, so the syntax-highlighted diff pane does not re-render.
 */
export function useResizableRail() {
  const width = useUIStore((state) => state.diffRailWidth);
  const setDiffRailWidth = useUIStore((state) => state.setDiffRailWidth);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    return () => {
      if (dragRef.current) restoreBodyStyles(dragRef.current);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Without this the browser starts a text selection on mousedown and the
    // drag paints the diff pane blue before userSelect: none applies.
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const startWidth = width;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      bodyCursor: document.body.style.cursor,
      bodyUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, drag.startWidth + event.clientX - drag.startX),
    );
    if (next === drag.width) return;
    drag.width = next;
    rootRef.current?.style.setProperty("--diff-rail", `${next}px`);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    restoreBodyStyles(drag);
    setDiffRailWidth(drag.width);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        next = width - step;
        break;
      case "ArrowRight":
        next = width + step;
        break;
      case "Home":
        next = MIN_WIDTH;
        break;
      case "End":
        next = MAX_WIDTH;
        break;
    }
    if (next === null) return;
    event.preventDefault();
    setDiffRailWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
  };

  return {
    width,
    rootRef,
    separatorProps: {
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "Resize file list",
      "aria-valuemin": MIN_WIDTH,
      "aria-valuemax": MAX_WIDTH,
      "aria-valuenow": width,
      tabIndex: 0,
      title: "Drag to resize · double-click to reset",
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onKeyDown,
      onDoubleClick: () => setDiffRailWidth(DEFAULT_WIDTH),
    },
  };
}
