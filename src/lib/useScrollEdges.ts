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
 *
 * The ref must be attached when the effect first runs. A pane that mounts
 * conditionally owns this hook itself, so the node and the subscription are
 * created together.
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>("none");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const pane = node;

    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overflows = pane.scrollHeight - pane.clientHeight > 4;
        if (!overflows) {
          setEdges("none");
          return;
        }
        const top = pane.scrollTop > 4;
        const bottom =
          pane.scrollTop + pane.clientHeight < pane.scrollHeight - 4;
        setEdges(
          top && bottom ? "both" : top ? "top" : bottom ? "bottom" : "none",
        );
      });
    }

    update();
    pane.addEventListener("scroll", update, { passive: true });
    // Content growth (rows arriving) changes scrollHeight without a resize of
    // the viewport, so watch the first child too when there is one.
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    let child = pane.firstElementChild;
    if (child) observer.observe(child);

    // The panel survives tab switches while its child is replaced. Re-observe
    // the new child and re-measure, otherwise the fades describe old content
    // until the user scrolls.
    const mutations = new MutationObserver(() => {
      const next = pane.firstElementChild;
      if (next !== child) {
        if (child) observer.unobserve(child);
        child = next;
        if (child) observer.observe(child);
      }
      update();
    });
    mutations.observe(pane, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      cancelAnimationFrame(frame);
      pane.removeEventListener("scroll", update);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [ref]);

  return edges;
}

export function scrollEdgeClass(edges: ScrollEdges): string {
  return FADE_CLASS[edges];
}
