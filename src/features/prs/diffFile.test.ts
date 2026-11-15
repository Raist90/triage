import { describe, expect, test } from "bun:test";
import { makeFile, makeHunk, makeLine } from "../../test/fixtures";
import type { SemanticChange } from "../../lib/types";
import {
  anchorSemanticChanges,
  compareByFocus,
  fileKinds,
  fileKey,
  findHunkIndex,
  focusBand,
  isCosmeticFile,
  reviewSignals,
  splitPath,
} from "./diffFile";

function change(partial: Partial<SemanticChange>): SemanticChange {
  return {
    changeType: "added",
    entityType: "function",
    entityName: "run",
    ...partial,
  };
}

const twoHunks = [
  makeHunk({
    header: "@@ -1,2 +1,2 @@",
    oldStart: 1,
    oldCount: 2,
    newStart: 1,
    newCount: 2,
    lines: [
      makeLine({ kind: "context", oldNumber: 1, newNumber: 1, text: "a" }),
      makeLine({ kind: "add", newNumber: 2, text: "b" }),
    ],
  }),
  makeHunk({
    header: "@@ -10,2 +10,2 @@",
    oldStart: 10,
    oldCount: 2,
    newStart: 10,
    newCount: 2,
    lines: [
      makeLine({ kind: "context", oldNumber: 10, newNumber: 10, text: "c" }),
      makeLine({ kind: "add", newNumber: 11, text: "d" }),
    ],
  }),
];

describe("findHunkIndex", () => {
  const file = makeFile({ hunks: twoHunks });

  test("prefers the hunk that contains the line", () => {
    expect(findHunkIndex(file, 2)).toBe(0);
    expect(findHunkIndex(file, 11)).toBe(1);
  });

  test("falls back to the nearest hunk", () => {
    expect(findHunkIndex(file, 7)).toBe(1);
    expect(findHunkIndex(file, 1)).toBe(0);
  });

  test("has no answer without a line or a hunk", () => {
    expect(findHunkIndex(file, undefined)).toBeUndefined();
    expect(findHunkIndex(file, 0)).toBeUndefined();
    expect(findHunkIndex(makeFile({ hunks: [] }), 2)).toBeUndefined();
  });
});

describe("anchorSemanticChanges", () => {
  test("anchors to the first hunk that changes a line in the entity", () => {
    const result = anchorSemanticChanges("src/app.ts", twoHunks, [
      change({ startLine: 1, endLine: 11, entityName: "spanning" }),
    ]);
    expect(result.byHunk[0]).toHaveLength(1);
    expect(result.byHunk[1]).toHaveLength(0);
  });

  test("anchors an unhunked change by range overlap", () => {
    const result = anchorSemanticChanges("src/app.ts", twoHunks, [
      change({ startLine: 9, endLine: 12, entityName: "overlap" }),
    ]);
    expect(result.byHunk[1]).toHaveLength(1);
  });

  test("keeps a change outside every hunk unanchored", () => {
    const result = anchorSemanticChanges("src/app.ts", twoHunks, [
      change({ startLine: 100, endLine: 101 }),
    ]);
    expect(result.unanchored).toHaveLength(1);
    expect(result.byHunk.flat()).toHaveLength(0);
  });

  test("uses a move's old range only when it stays in this file", () => {
    const moved = change({
      changeType: "moved",
      startLine: undefined,
      endLine: undefined,
      oldStartLine: 1,
      oldEndLine: 2,
    });
    expect(
      anchorSemanticChanges("src/app.ts", twoHunks, [
        { ...moved, oldFilePath: "src/app.ts" },
      ]).byHunk[0],
    ).toHaveLength(1);
    expect(
      anchorSemanticChanges("src/app.ts", twoHunks, [
        { ...moved, oldFilePath: "src/other.ts" },
      ]).unanchored,
    ).toHaveLength(1);
  });
});

describe("file classification", () => {
  test("keeps file kinds in display order and drops unknown values", () => {
    const file = makeFile({ kinds: ["generated", "bogus", "test"] });
    expect(fileKinds(file)).toEqual(["test", "generated"]);
  });

  test("calls a file cosmetic only when every change is cosmetic", () => {
    expect(
      isCosmeticFile(
        makeFile({
          semantic: [change({ cosmetic: true }), change({ cosmetic: true })],
        }),
      ),
    ).toBe(true);
    expect(
      isCosmeticFile(
        makeFile({
          semantic: [change({ cosmetic: true }), change({ cosmetic: false })],
        }),
      ),
    ).toBe(false);
    expect(isCosmeticFile(makeFile({ semantic: [] }))).toBe(false);
  });

  test("derives focus order and copy from the server review", () => {
    const high = makeFile({
      review: {
        band: "high",
        score: 80,
        changes: { added: 1, modified: 0, deleted: 0, cosmetic: 0 },
        signals: { deletes: 2, noTests: true },
      },
    });
    const low = makeFile({ path: "src/b.ts" });
    expect(compareByFocus(high, low)).toBeLessThan(0);
    expect(focusBand(high)).toBe("high");
    expect(focusBand(low)).toBe("low");
    expect(reviewSignals(high)).toEqual(["deletes 2", "no tests changed"]);
  });

  test("splits a path into directory and basename", () => {
    expect(splitPath("src/features/app.ts")).toEqual({
      dir: "src/features/",
      name: "app.ts",
    });
    expect(splitPath("app.ts")).toEqual({ dir: "", name: "app.ts" });
    expect(fileKey(makeFile({ path: "a.ts" }), 3)).toBe("a.ts:3");
  });
});
