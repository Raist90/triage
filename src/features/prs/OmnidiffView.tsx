import { RefreshCw } from "lucide-react";
import { Button, MicroLabel } from "../../components/ui";
import { describeError } from "../../lib/api";
import type {
  OmnidiffFile,
  OmnidiffLine,
  OmnidiffSpanKind,
  PROmnidiffResponse,
} from "../../lib/types";

type OmnidiffViewProps = {
  data: PROmnidiffResponse | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
};

/**
 * Experimental comparison tab. OmniDiff paints the bytes that changed, so its
 * ANSI palette is mapped onto the cockpit's tokens here. The whole component is
 * disposable: removing the tab removes every reference to it.
 */
export function OmnidiffView({
  data,
  isPending,
  isError,
  isFetching,
  error,
  onRetry,
}: OmnidiffViewProps) {
  if (isPending) {
    return (
      <div aria-hidden="true" className="m-3 rounded-[6px] border border-line">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="border-b border-line px-3 py-3 last:border-b-0"
          >
            <div className="h-3 w-1/2 animate-pulse rounded-[4px] bg-surface" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="m-3 rounded-[6px] border border-line p-3 text-meta text-fg-faint"
      >
        <p className="text-fg-muted">Omnidiff could not render this diff.</p>
        <p className="mt-1">{describeError(error)}</p>
        <Button
          variant="outline"
          onClick={onRetry}
          disabled={isFetching}
          className="mt-2"
        >
          {isFetching ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );
  }

  if (!data?.available) {
    return (
      <div className="m-3 rounded-[6px] border border-line p-3 text-meta text-fg-faint">
        <p className="text-fg-muted">Omnidiff is not available.</p>
        <p className="mt-1">
          {data?.reason ??
            "Install the CLI with brew install ivankovic/omnidiff/omnidiff, then restart Triage."}
        </p>
      </div>
    );
  }

  const rendered = data.files.filter(
    (file) => (file.sections?.length ?? 0) > 0,
  );
  const skipped = data.files.filter(
    (file) => !file.sections?.length && (file.skipped || file.error),
  );

  if (rendered.length === 0 && skipped.length === 0) {
    return <p className="p-4 text-meta text-fg-faint">No textual changes.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isFetching ? (
        <div className="flex h-8 shrink-0 items-center justify-end px-3">
          <RefreshCw
            className="size-3 animate-spin text-fg-faint"
            aria-label="Refreshing omnidiff"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {rendered.map((file) => (
          <FileBlock key={file.path} file={file} />
        ))}

        {skipped.length > 0 ? (
          <section
            aria-label="Files omnidiff skipped"
            className="border-t border-line"
          >
            <div className="flex h-8 items-center px-3">
              <MicroLabel>Skipped</MicroLabel>
            </div>
            {skipped.map((file) => (
              <div
                key={file.path}
                className="flex items-baseline gap-2 border-t border-line px-3 py-2"
              >
                <span className="min-w-0 truncate font-mono text-meta text-fg-muted">
                  {file.path}
                </span>
                <span className="ml-auto shrink-0 text-micro text-fg-faint">
                  {file.error ?? file.skipped}
                </span>
              </div>
            ))}
          </section>
        ) : null}

        {data.truncated ? (
          <p className="border-t border-line px-3 py-2 text-meta text-fg-faint">
            Some files were left out of the Omnidiff render by the file budget.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FileBlock({ file }: { file: OmnidiffFile }) {
  return (
    <section className="border-b border-line">
      <header className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line bg-canvas px-3">
        <span className="min-w-0 truncate font-mono text-meta text-fg-body">
          {file.path}
        </span>
        <span className="tabular ml-auto shrink-0 font-mono text-micro text-fg-faint">
          <span className="text-accent">+{file.additions}</span>
          <span className="px-1 text-line-strong">/</span>
          <span className="text-danger">−{file.deletions}</span>
        </span>
      </header>

      {file.summary?.length ? (
        <div className="border-b border-line bg-surface px-3 py-1">
          <Lines lines={file.summary} />
        </div>
      ) : null}

      {file.sections?.map((section) => (
        <div key={section.side}>
          <div className="flex h-6 items-center gap-2 bg-surface px-3">
            <span className="text-micro tracking-[0.06em] text-fg-faint uppercase">
              {section.side}
            </span>
            <span className="min-w-0 truncate font-mono text-micro text-fg-faint">
              {section.path}
            </span>
          </div>
          <Lines lines={section.lines} />
        </div>
      ))}
    </section>
  );
}

function Lines({ lines }: { lines: OmnidiffLine[] }) {
  return (
    <div className="tabular font-mono text-code">
      {lines.map((line, index) => (
        <div
          key={index}
          className={`px-3 whitespace-pre ${lineTint(line.kind)} ${lineColor(
            line.kind,
          )}`}
        >
          {line.spans.map((span, spanIndex) => (
            <span key={spanIndex} className={spanColor(span.kind)}>
              {span.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function lineTint(kind: OmnidiffLine["kind"]): string {
  if (kind === "add") return "bg-diff-add-line";
  if (kind === "del") return "bg-diff-del-line";
  return "";
}

function lineColor(kind: OmnidiffLine["kind"]): string {
  if (kind === "add" || kind === "change" || kind === "summary") {
    return "text-fg";
  }
  if (kind === "del") return "text-fg-body";
  return "text-fg-muted";
}

/** Only these three roles exist in the cockpit, plus faint and strong text. */
function spanColor(kind: OmnidiffSpanKind): string {
  switch (kind) {
    case "add":
      return "text-accent";
    case "del":
      return "text-danger";
    case "change":
      return "text-fg font-medium";
    case "dim":
      return "text-fg-faint";
    case "strong":
      return "text-fg font-medium";
    default:
      return "";
  }
}
