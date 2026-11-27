import { useLayoutEffect, useState, type RefObject } from "react";

export type OverlaySide = "up" | "down";

type Placement = {
  side: OverlaySide;
  /** Visible height in px on the chosen side, capped by `maxHeight`. */
  maxHeight: number | undefined;
};

type UseOverlaySideOptions = {
  /** The trigger the panel is anchored to. Defaults to the panel's parent. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** The panel itself; measured once it is mounted. */
  panelRef: RefObject<HTMLElement | null>;
  /** Recompute whenever this flips true, and while true on resize. */
  open: boolean;
  /** Preferred cap, e.g. 480 for the filter panel. */
  maxHeight?: number;
  /** Distance kept between the anchor and the panel. */
  gap?: number;
  /** Distance kept between the panel and the viewport edge. */
  margin?: number;
};

/**
 * Picks the vertical side for an anchored panel: below the trigger by default,
 * above it when the bottom of the viewport cannot fit the panel and the top
 * has more room. The returned height caps the panel so it never runs off the
 * screen.
 */
export function useOverlaySide({
  anchorRef,
  panelRef,
  open,
  maxHeight = Number.POSITIVE_INFINITY,
  gap = 4,
  margin = 8,
}: UseOverlaySideOptions): Placement {
  const [placement, setPlacement] = useState<Placement>({
    side: "down",
    maxHeight: undefined,
  });

  useLayoutEffect(() => {
    if (!open) return;

    function measure() {
      const panel = panelRef.current;
      if (!panel) return;
      const anchor = anchorRef?.current ?? panel.parentElement;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      // scrollHeight is the panel's natural content height, unaffected by the
      // cap applied below.
      const needed = Math.min(panel.scrollHeight, maxHeight);
      const side: OverlaySide =
        below >= needed || below >= above ? "down" : "up";
      const available = side === "up" ? above : below;
      const height = Math.max(Math.min(available, maxHeight), 120);
      setPlacement((current) =>
        current.side === side && Math.abs((current.maxHeight ?? 0) - height) < 1
          ? current
          : { side, maxHeight: height },
      );
    }

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, anchorRef, panelRef, maxHeight, gap, margin]);

  return placement;
}
