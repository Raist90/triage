export type SectionRect = {
  key: string;
  top: number;
  bottom: number;
};

/**
 * True when the pane cannot scroll any further toward the end. Short trailing
 * files then sit fully inside the viewport without ever crossing its top edge,
 * so top-edge inference alone keeps an earlier file selected.
 */
export function clampedAtBottom(pane: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
}

/**
 * The section that owns the pane's top edge. A section fully above the edge
 * loses to the first one that starts below it. Clamping at the bottom is not a
 * top-edge question: the caller checks `clampedAtBottom` and lets the last
 * rendered body own the selection there.
 */
export function activeSectionKey(
  sections: SectionRect[],
  threshold: number,
): string | null {
  let firstBelow: string | null = null;
  for (const { key, top, bottom } of sections) {
    if (top <= threshold && bottom > threshold) return key;
    if (firstBelow === null && top > threshold) firstBelow = key;
  }
  return firstBelow ?? sections[sections.length - 1]?.key ?? null;
}
