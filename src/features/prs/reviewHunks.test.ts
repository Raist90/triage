import { describe, expect, test } from "bun:test";
import { makeFile, makeHunk, makeLine } from "../../test/fixtures";
import { findHunk, sliceHunk } from "./reviewHunks";

const hunk = makeHunk({
  lines: Array.from({ length: 20 }, (_, index) =>
    makeLine({
      kind: "context",
      oldNumber: index + 1,
      newNumber: index + 1,
      text: `line ${index + 1}`,
    }),
  ),
});

describe("findHunk", () => {
  const file = makeFile({ path: "src/app.ts", hunks: [hunk] });

  test("finds a file by path and returns the focused line", () => {
    const match = findHunk([file], "src/app.ts", 12);
    expect(match?.file.path).toBe("src/app.ts");
    expect(match?.focusedLine?.newNumber).toBe(12);
  });

  test("falls back to the old path for a rename", () => {
    const renamed = makeFile({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      hunks: [hunk],
    });
    expect(findHunk([renamed], "src/old.ts", 3)?.file.path).toBe("src/new.ts");
  });

  test("treats an undefined line as the first hunk without evidence", () => {
    const match = findHunk([file], "src/app.ts", undefined);
    expect(match?.index).toBe(0);
    expect(match?.focusedLine).toBeUndefined();
  });

  test("returns null for an unknown, binary or hunkless file", () => {
    expect(findHunk([], "src/app.ts", 1)).toBeNull();
    expect(
      findHunk(
        [makeFile({ path: "src/app.ts", binary: true })],
        "src/app.ts",
        1,
      ),
    ).toBeNull();
    expect(
      findHunk([makeFile({ path: "src/app.ts", hunks: [] })], "src/app.ts", 1),
    ).toBeNull();
  });
});

describe("sliceHunk", () => {
  test("returns the whole hunk when it fits", () => {
    expect(sliceHunk(hunk, 5, 40)).toHaveLength(20);
  });

  test("centers a bounded slice on the focused line", () => {
    const lines = sliceHunk(hunk, 12, 4);
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.newNumber)).toEqual([10, 11, 12, 13]);
  });

  test("clamps the slice at the edges without synthesizing lines", () => {
    expect(sliceHunk(hunk, 1, 4).map((line) => line.newNumber)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(sliceHunk(hunk, 20, 4).map((line) => line.newNumber)).toEqual([
      17, 18, 19, 20,
    ]);
  });
});
