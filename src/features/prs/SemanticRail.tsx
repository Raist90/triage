import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { DiffFile, SemanticChange } from "../../lib/types";
import { anchorSemanticChanges } from "./diffFile";
import {
  changeTitle,
  tallyChanges,
  tallyText,
  tickClassName,
} from "./semantics";

type RailFile = {
  key: string;
  file: DiffFile;
};

type SemanticRailProps = {
  paneRef: RefObject<HTMLDivElement | null>;
  /** Visible files in rendered order, after every filter. */
  files: RailFile[];
  expanded: Set<string>;
  /** Focus mode renders one file, so collapsed files must not be clickable. */
  singleFile: boolean;
  /** Re-measure whenever files, expansion or semantic data change. */
  layoutKey: string;
  onJump: (fileKey: string, hunkIndex: number) => void;
};

type RailTick = {
  id: string;
  fileKey: string;
  hunkIndex: number;
  /** Distance from the top of the rail, in pixels. */
  top: number;
  /** Height of the mark itself, in pixels. */
  height: number;
  className: string;
  title: string;
  label: string;
};

type RailBand = {
  key: string;
  top: number;
};

type RailViewport = {
  top: number;
  height: number;
};

/**
 * Compressed map of the whole rendered diff. One tick per changed hunk, or one
 * aggregate tick per collapsed file. Positions come from measured DOM offsets,
 * so comment rows, open composers and collapsing never desync it.
 */
export function SemanticRail({
  paneRef,
  files,
  expanded,
  singleFile,
  layoutKey,
  onJump,
}: SemanticRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [ticks, setTicks] = useState<RailTick[]>([]);
  const [bands, setBands] = useState<RailBand[]>([]);
  const [viewport, setViewport] = useState<RailViewport>({
    top: 0,
    height: 0,
  });
  const [measureVersion, setMeasureVersion] = useState(0);

  // Keep the latest rows reachable from the layout effect without making the
  // file arrays an effect dependency; they are rebuilt on every render.
  const dataRef = useRef<RailFile[]>(files);
  const expandedRef = useRef<Set<string>>(expanded);
  useLayoutEffect(() => {
    dataRef.current = files;
    expandedRef.current = expanded;
  });

  useLayoutEffect(() => {
    const pane = paneRef.current;
    const rail = railRef.current;
    if (!pane || !rail) return;

    const railHeight = rail.clientHeight;
    const contentHeight = pane.scrollHeight;
    if (railHeight <= 0 || contentHeight <= 0) return;
    const scale = railHeight / contentHeight;
    const contentTop = pane.getBoundingClientRect().top - pane.scrollTop;

    const sections = new Map<string, HTMLElement>();
    for (const element of pane.querySelectorAll<HTMLElement>(
      "[data-diff-file]",
    )) {
      const key = element.dataset.diffFile;
      if (key) sections.set(key, element);
    }
    const hunks = new Map<string, HTMLElement>();
    for (const element of pane.querySelectorAll<HTMLElement>(
      "[data-diff-hunk]",
    )) {
      const key = element.dataset.diffHunk;
      if (key) hunks.set(key, element);
    }

    const nextBands: RailBand[] = [];
    const nextTicks: RailTick[] = [];

    for (const { key, file } of dataRef.current) {
      const section = sections.get(key);
      if (!section) continue;
      const sectionTop =
        (section.getBoundingClientRect().top - contentTop) * scale;
      nextBands.push({ key, top: sectionTop });

      const changes = file.semantic ?? [];
      if (changes.length === 0) continue;

      const open = expandedRef.current.has(key);
      // Focus mode shows a single file: collapsed sections are only 36px
      // headers, so their aggregate ticks would stack into a few pixels at the
      // bottom of the rail and swallow clicks meant for the open file's hunks.
      if (singleFile && !open) continue;

      const fileHunks = file.hunks ?? [];
      if (open && fileHunks.length > 0) {
        const { byHunk } = anchorSemanticChanges(file.path, fileHunks, changes);
        byHunk.forEach((group, hunkIndex) => {
          if (group.length === 0) return;
          const element = hunks.get(`${key}:${hunkIndex}`);
          if (!element) return;
          const top =
            (element.getBoundingClientRect().top - contentTop) * scale;
          nextTicks.push(
            buildTick(key, hunkIndex, top, group, file.path, false),
          );
        });
        continue;
      }

      // Collapsed or unstructured file: one tick, jumping expands the file.
      const firstHunk = firstChangedHunk(file, changes);
      nextTicks.push(
        buildTick(key, firstHunk, sectionTop + 2, changes, file.path, true),
      );
    }

    setTicks((current) =>
      sameTicks(current, nextTicks) ? current : nextTicks,
    );
    setBands((current) =>
      sameBands(current, nextBands) ? current : nextBands,
    );
  }, [paneRef, singleFile, layoutKey, measureVersion]);

  // Section heights move when comments or composers open, without any state
  // the rail knows about. Observe them instead of polling.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const observer = new ResizeObserver(() => {
      setMeasureVersion((version) => version + 1);
    });
    for (const section of pane.querySelectorAll("[data-diff-file]")) {
      observer.observe(section);
    }
    return () => observer.disconnect();
  }, [paneRef, layoutKey]);

  useEffect(() => {
    const pane = paneRef.current;
    const rail = railRef.current;
    if (!pane || !rail) return;
    let frame: number | null = null;

    const update = () => {
      frame = null;
      const total = pane.scrollHeight;
      const height = rail.clientHeight;
      if (total <= 0 || height <= 0) return;
      const windowHeight = Math.min(
        height,
        Math.max(10, (pane.clientHeight / total) * height),
      );
      const maxTop = Math.max(0, height - windowHeight);
      const top = Math.min(maxTop, (pane.scrollTop / total) * height);
      setViewport((current) =>
        current.top === top && current.height === windowHeight
          ? current
          : { top, height: windowHeight },
      );
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };

    update();
    pane.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      pane.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [paneRef, layoutKey, measureVersion]);

  return (
    <nav
      ref={railRef}
      aria-label="Semantic change map"
      className="relative w-10 shrink-0 border-l border-line bg-canvas"
    >
      {bands.map((band) => (
        <span
          key={band.key}
          aria-hidden
          className="absolute inset-x-0 h-px bg-line"
          style={{ top: band.top }}
        />
      ))}

      {ticks.map((tick) => (
        <button
          key={tick.id}
          type="button"
          onClick={() => onJump(tick.fileKey, tick.hunkIndex)}
          title={tick.title}
          aria-label={tick.label}
          className="group absolute inset-x-0 z-10 flex items-center justify-center focus:outline-none"
          style={{
            top: Math.max(0, tick.top - 6),
            height: Math.max(12, tick.height + 6),
          }}
        >
          <span
            className={`w-1.5 rounded-full opacity-70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${tick.className}`}
            style={{ height: Math.max(2, tick.height) }}
          />
        </button>
      ))}

      {viewport.height > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1 z-20 rounded-[2px] border border-fg-faint/50"
          style={{
            top: viewport.top,
            height: Math.max(8, viewport.height),
          }}
        />
      ) : null}
    </nav>
  );
}

function buildTick(
  fileKey: string,
  hunkIndex: number,
  top: number,
  changes: SemanticChange[],
  filePath: string,
  aggregate: boolean,
): RailTick {
  const tally = tallyChanges(changes);
  const count = changes.length;
  return {
    id: `${fileKey}:${hunkIndex}`,
    fileKey,
    hunkIndex,
    top,
    height: Math.min(10, 1 + count * 1.5),
    className: tickClassName(tally.dominant),
    title: changes.map((change) => changeTitle(change, filePath)).join("\n"),
    label: aggregate
      ? `${count} semantic ${count === 1 ? "change" : "changes"} in ${filePath}. Expand the file and jump.`
      : `${tallyText(tally)} in ${filePath}. Jump to hunk.`,
  };
}

function firstChangedHunk(file: DiffFile, changes: SemanticChange[]): number {
  const hunks = file.hunks ?? [];
  if (hunks.length === 0) return 0;
  const { byHunk } = anchorSemanticChanges(file.path, hunks, changes);
  const index = byHunk.findIndex((group) => group.length > 0);
  return index === -1 ? 0 : index;
}

function sameTicks(a: RailTick[], b: RailTick[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tick, index) => {
    const next = b[index];
    return (
      next !== undefined &&
      tick.id === next.id &&
      tick.top === next.top &&
      tick.height === next.height &&
      tick.title === next.title
    );
  });
}

function sameBands(a: RailBand[], b: RailBand[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (band, index) => b[index]?.key === band.key && b[index].top === band.top,
  );
}
