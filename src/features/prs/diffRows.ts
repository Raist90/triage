import type { DiffLine, DiffSpan } from "../../lib/types";

export type RawHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Splits a raw patch into hunks; header lines before the first hunk drop. */
export function parsePatch(patch: string): RawHunk[] {
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  const hunks: RawHunk[] = [];
  let current: RawHunk | null = null;
  for (const line of lines) {
    const match = HUNK_HEADER.exec(line);
    if (match) {
      current = {
        header: line,
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return hunks;
}

export function rowTint(kind: DiffLine["kind"]): string {
  if (kind === "add") return "bg-diff-add-line";
  if (kind === "del") return "bg-diff-del-line";
  return "";
}

export function codeClasses(kind: DiffLine["kind"]): string {
  if (kind === "add") return "text-fg";
  if (kind === "del") return "text-fg-body";
  return "text-fg-muted";
}

export function emphasisClasses(kind: DiffLine["kind"]): string {
  return kind === "del" ? "bg-diff-del-word" : "bg-diff-add-word";
}

const SYNTAX_CLASS: Record<NonNullable<DiffSpan["kind"]>, string> = {
  keyword: "text-syn-keyword",
  string: "text-syn-string",
  number: "text-syn-number",
  comment: "text-syn-comment italic",
  func: "text-syn-func",
  tag: "text-syn-tag",
  type: "text-syn-type",
  // Constants share the number hue; variable/property stay regular text.
  builtin: "text-syn-number",
  variable: "",
  property: "",
};

export function spanClasses(kind: DiffLine["kind"], span: DiffSpan): string {
  const classes: string[] = [];
  const syntax = span.kind ? SYNTAX_CLASS[span.kind] : "";
  if (syntax) classes.push(syntax);
  if (span.emph) classes.push(emphasisClasses(kind));
  return classes.join(" ");
}

/** Row classes for an unstructured patch: the raw text decides the tint. */
export function lineClasses(line: string): string {
  if (line.startsWith("@@")) {
    return "bg-surface px-3 py-1 text-fg-faint";
  }
  if (line.startsWith("+")) {
    return "border-l-2 border-l-accent/40 bg-diff-add-line px-3 text-fg";
  }
  if (line.startsWith("-")) {
    return "border-l-2 border-l-danger/40 bg-diff-del-line pr-3 pl-[10px] text-fg-body";
  }
  return "border-l-2 border-l-transparent px-3 text-fg-muted";
}
