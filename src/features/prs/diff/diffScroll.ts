export type SectionRect = {
  key: string;
  top: number;
  bottom: number;
};

/**
 * True when a scrollable pane cannot scroll any further toward the end. Short
 * trailing files then sit fully inside the viewport without ever crossing its
 * top edge, so top-edge inference alone keeps an earlier file selected.
 *
 * A pane whose content fits without scrolling is not at the bottom: its top
 * edge still owns the selection, so the bottom clamp must not apply there.
 */
export function clampedAtBottom(pane: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return (
    pane.scrollHeight > pane.clientHeight &&
    pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1
  );
}

/**
 * The section that owns the pane's top edge. A section fully above the edge
 * loses to the first one that starts below it. Clamping at the bottom is not a
 * top-edge question: the caller checks `clampedAtBottom` and lets the last
 * rendered body own the selection there while that body still reaches below
 * the edge.
 */
export function activeSectionKey(
  sections: SectionRect[],
  threshold: number,
  /** Live entries; the scroll handler reuses one buffer, so it can hold more. */
  count = sections.length,
): string | null {
  let firstBelow: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const { key, top, bottom } = sections[index];
    if (top <= threshold && bottom > threshold) return key;
    if (firstBelow === null && top > threshold) firstBelow = key;
  }
  return firstBelow ?? sections[count - 1]?.key ?? null;
}
