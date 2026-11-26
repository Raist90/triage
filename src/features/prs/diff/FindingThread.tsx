import { ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui";
import { cx } from "../../../lib/cx";
import { formatAgo } from "../../../lib/time";
import type { ReviewFinding, ReviewSeverity } from "../../../lib/types";
import { useReviewFindings } from "./ReviewFindingsContext";

const SEVERITY_TAG: Record<ReviewSeverity, string> = {
  blocking: "border-danger/32 text-danger",
  warning: "border-line text-fg-muted",
  nitpick: "border-line text-fg-faint",
  praise: "border-accent/28 text-accent",
};

/** The 2px rail is the only severity signal a scrolled thread needs. */
const SEVERITY_RAIL: Record<ReviewSeverity, string> = {
  blocking: "border-l-danger",
  warning: "border-l-fg-muted",
  nitpick: "border-l-line-strong",
  praise: "border-l-accent",
};

/**
 * One review finding rendered under the line it cites. Text, severity, the
 * apply action and its failure; never a Reply control (nothing is published).
 */
export function FindingThread({ finding }: { finding: ReviewFinding }) {
  const { artifact, applying, applyFailure, onApply } = useReviewFindings();
  const [preview, setPreview] = useState(false);
  const busy = applying === finding.id;
  const failure = applyFailure?.id === finding.id ? applyFailure.message : null;
  const when = artifact ? formatAgo(artifact.createdAt) : "";

  return (
    <div className="border-b border-line bg-surface">
      <div
        className={cx(
          "border-l-2 px-3 py-2",
          SEVERITY_RAIL[finding.severity] ?? "border-l-line-strong",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full border border-line text-fg-faint">
            <Sparkles className="size-3" aria-hidden />
          </span>
          <span className="text-meta font-medium text-fg-body">
            triage review
          </span>
          <span
            className={cx(
              "inline-flex h-4.5 shrink-0 items-center rounded-sm border px-1 font-mono text-micro",
              SEVERITY_TAG[finding.severity] ?? "border-line text-fg-faint",
            )}
          >
            {finding.severity}
          </span>
          {finding.anchored ? null : (
            <span className="shrink-0 text-micro text-fg-faint">
              no exact line
            </span>
          )}
          {when ? (
            <span className="ml-auto shrink-0 font-mono text-micro text-fg-faint">
              {when}
            </span>
          ) : null}
        </div>

        <h3 className="mt-1 text-ui font-medium text-fg">{finding.title}</h3>
        <p className="mt-0.5 max-w-[72ch] text-meta leading-4.5 text-fg-muted">
          {finding.claim}
        </p>
        {finding.suggestion ? (
          <p className="mt-1 max-w-[72ch] text-meta leading-4.5 text-fg-body">
            {finding.suggestion}
          </p>
        ) : null}

        {finding.patch || finding.appliedAt ? (
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {finding.appliedAt ? (
              <span className="text-meta text-accent">
                Applied {formatAgo(finding.appliedAt)} · not pushed
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setPreview((current) => !current)}
                  aria-expanded={preview}
                  className="inline-flex items-center gap-1 text-meta text-fg-muted transition-colors hover:text-fg"
                >
                  <ChevronRight
                    className={cx(
                      "size-3 transition-transform",
                      preview && "rotate-90",
                    )}
                    aria-hidden
                  />
                  {preview ? "Hide patch" : "Patch"}
                </button>
                <Button
                  variant="outline"
                  onClick={() => onApply(finding)}
                  disabled={busy}
                >
                  {busy ? "Applying…" : "Apply patch"}
                </Button>
              </>
            )}
          </div>
        ) : null}

        {preview && finding.patch && !finding.appliedAt ? (
          <PatchPreview patch={finding.patch} />
        ) : null}

        {failure ? (
          <p role="alert" className="mt-1 text-meta text-danger">
            {failure}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const PATCH_LINE_CLASS = {
  header: "text-fg-faint",
  add: "text-accent",
  del: "text-danger",
  hunk: "text-fg-faint",
  context: "text-fg-body",
} as const;

function patchLineKind(line: string): keyof typeof PATCH_LINE_CLASS {
  if (line.startsWith("+++") || line.startsWith("---")) return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/** The raw patch, read-only. Colour by prefix, no syntax highlighting. */
function PatchPreview({ patch }: { patch: string }) {
  return (
    <div className="mt-2 max-h-60 overflow-auto rounded-sm border border-line bg-canvas px-3 py-2">
      {patch.split("\n").map((line, index) => (
        <div
          key={index}
          className={cx(
            "font-mono text-code whitespace-pre",
            PATCH_LINE_CLASS[patchLineKind(line)],
          )}
        >
          {line === "" ? " " : line}
        </div>
      ))}
    </div>
  );
}
