import { lineClasses, parsePatch } from "./diffRows";

/** Fallback for patches the backend could not structure. */
export function RawPatch({ patch }: { patch: string }) {
  const hunks = parsePatch(patch);
  if (hunks.length === 0) {
    return (
      <p className="border-t border-line bg-canvas px-3 py-2 text-meta text-fg-faint">
        No textual changes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-line bg-canvas">
      <div className="min-w-max font-mono text-code">
        {hunks.map((hunk, index) => (
          <div key={`${hunk.header}:${index}`}>
            <div className={lineClasses(hunk.header)}>{hunk.header || " "}</div>
            {hunk.lines.map((line, lineIndex) => (
              <div key={lineIndex} className={lineClasses(line)}>
                {line || " "}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
