import { describe, expect, test } from "bun:test";
import type { ReviewFinding } from "../../../lib/types";
import { makeHunk, makeLine } from "../../../test/fixtures";
import { anchorFindings, findingsForFile } from "./findingAnchors";

function finding(partial: Partial<ReviewFinding>): ReviewFinding {
  return {
    id: "f",
    anchored: true,
    category: "risk",
    claim: "claim",
    file: "src/a.ts",
    line: 1,
    severity: "blocking",
    title: "title",
    ...partial,
  };
}

const hunk = makeHunk({
  lines: [
    makeLine({ kind: "del", oldNumber: 5, text: "old line" }),
    makeLine({ kind: "add", newNumber: 5, text: "new line" }),
    makeLine({ kind: "context", oldNumber: 6, newNumber: 6, text: "ctx" }),
  ],
});

describe("anchorFindings", () => {
  test("a replaced line renders the finding once, on the new side", () => {
    const byLine = anchorFindings(hunk, [finding({ line: 5 })]);
    expect(byLine.get(0)).toBeUndefined();
    expect(byLine.get(1)?.map((item) => item.id)).toEqual(["f"]);
    expect(byLine.get(2)).toBeUndefined();
  });

  test("removed files fall back to the old side", () => {
    const removed = makeHunk({
      lines: [makeLine({ kind: "del", oldNumber: 9, text: "gone" })],
    });
    const byLine = anchorFindings(removed, [finding({ line: 9 })]);
    expect(byLine.get(0)?.length).toBe(1);
  });

  test("a line outside the hunk is not anchored", () => {
    expect(anchorFindings(hunk, [finding({ line: 400 })]).size).toBe(0);
  });

  test("findings for other files are ignored", () => {
    expect(
      findingsForFile([finding({ file: "src/b.ts" })], "src/a.ts"),
    ).toEqual([]);
  });
});
