import { cx } from "../../../lib/cx";
import type { Complexity } from "../../../lib/types";
import { complexityLines } from "../diff/semantics";

const COMPLEXITY_TICKS: Record<Complexity["band"], string> = {
  high: "bg-accent",
  medium: "bg-fg-muted",
  low: "bg-fg-faint",
};

const COMPLEXITY_FILL: Record<Complexity["band"], number> = {
  high: 5,
  medium: 3,
  low: 1,
};

export function ComplexityMeter({ complexity }: { complexity: Complexity }) {
  const lines = complexityLines(complexity);
  return (
    <div
      className="mt-2"
      role="img"
      aria-label={`Complexity ${complexity.band}, score ${complexity.score} out of 100. ${lines.join(". ")}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="flex gap-1">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={cx(
                "h-1 w-4 rounded-full",
                index < COMPLEXITY_FILL[complexity.band]
                  ? COMPLEXITY_TICKS[complexity.band]
                  : "bg-line",
              )}
            />
          ))}
        </span>
        <span aria-hidden="true" className="text-meta text-fg-muted">
          {complexity.band}
          <span className="px-1 text-line-strong">·</span>
          <span className="font-mono tabular-nums">{complexity.score}</span>
        </span>
      </div>
      {lines.map((line) => (
        <p
          key={line}
          aria-hidden="true"
          className="mt-1 text-micro text-fg-faint"
        >
          {line}
        </p>
      ))}
    </div>
  );
}
