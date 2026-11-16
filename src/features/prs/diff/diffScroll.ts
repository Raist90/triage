export type SectionRect = {
  key: string;
  top: number;
  bottom: number;
};

/**
 * The section that owns the pane's top edge. A section fully above the edge
 * loses to the first one that starts below it, and a jump that clamps to the
 * bottom falls back to the last rendered section.
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
