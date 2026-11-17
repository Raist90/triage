import { useEffect, useState, type RefObject } from "react";

export type ScrollEdges = "none" | "top" | "bottom" | "both";

const FADE_CLASS: Record<ScrollEdges, string> = {
  none: "",
  top: "fade-top",
  bottom: "fade-bottom",
  both: "fade-both",
};

/**
 * Reports which edges of a scroll container are clipped, so the pane can fade
 * content there instead of cutting it against a hard line. A container that
 * does not scroll gets no fade at all.
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>("none");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let frame = 0;
    function update() {
      if (!node) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overflows = node.scrollHeight - node.clientHeight > 4;
        if (!overflows) {
          setEdges("none");
          return;
        }
        const top = node.scrollTop > 4;
        const bottom =
          node.scrollTop + node.clientHeight < node.scrollHeight - 4;
        setEdges(
          top && bottom ? "both" : top ? "top" : bottom ? "bottom" : "none",
        );
      });
    }

    update();
    node.addEventListener("scroll", update, { passive: true });
    // Content growth (rows arriving) changes scrollHeight without a resize of
    // the viewport, so watch the first child too when there is one.
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref]);

  return edges;
}

export function scrollEdgeClass(edges: ScrollEdges): string {
  return FADE_CLASS[edges];
}
