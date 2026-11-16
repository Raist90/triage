import { describe, expect, test } from "bun:test";
import {
  codeClasses,
  emphasisClasses,
  lineClasses,
  parsePatch,
  rowTint,
  spanClasses,
} from "./diffRows";

describe("parsePatch", () => {
  test("returns no hunks for an empty patch", () => {
    expect(parsePatch("")).toEqual([]);
  });

  test("reads starts, explicit counts and the lines after a header", () => {
    const hunks = parsePatch(
      "@@ -3,2 +4,3 @@ function name\n context\n-old\n+new\n",
    );

    expect(hunks).toEqual([
      {
        header: "@@ -3,2 +4,3 @@ function name",
        oldStart: 3,
        oldCount: 2,
        newStart: 4,
        newCount: 3,
        lines: [" context", "-old", "+new"],
      },
    ]);
  });

  test("an omitted count means one line on that side", () => {
    const [hunk] = parsePatch("@@ -1 +1 @@\n-old\n+new");
    expect(hunk.oldCount).toBe(1);
    expect(hunk.newCount).toBe(1);
  });

  test("drops header lines before the first hunk", () => {
    const hunks = parsePatch(
      "diff --git a/x b/x\nindex 1..2\n@@ -1 +1 @@\n-x\n+y",
    );
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toEqual(["-x", "+y"]);
  });
});

describe("row styling", () => {
  test("add and del rows get their tint and text color", () => {
    expect(rowTint("add")).toBe("bg-diff-add-line");
    expect(rowTint("del")).toBe("bg-diff-del-line");
    expect(rowTint("context")).toBe("");
    expect(codeClasses("add")).toBe("text-fg");
    expect(codeClasses("del")).toBe("text-fg-body");
    expect(codeClasses("context")).toBe("text-fg-muted");
  });

  test("emphasis follows the deletion side", () => {
    expect(emphasisClasses("del")).toBe("bg-diff-del-word");
    expect(emphasisClasses("add")).toBe("bg-diff-add-word");
  });

  test("syntax and emphasis classes combine; unknown kinds stay plain", () => {
    expect(
      spanClasses("add", { text: "const", kind: "keyword", emph: true }),
    ).toBe("text-syn-keyword bg-diff-add-word");
    expect(spanClasses("del", { text: "x", kind: "comment" })).toBe(
      "text-syn-comment italic",
    );
    expect(spanClasses("context", { text: "x" })).toBe("");
    expect(spanClasses("context", { text: "x", kind: "variable" })).toBe("");
  });

  test("raw patch lines are tinted from their first character", () => {
    expect(lineClasses("@@ -1 +1 @@")).toBe(
      "bg-surface px-3 py-1 text-fg-faint",
    );
    expect(lineClasses("+new")).toContain("bg-diff-add-line");
    expect(lineClasses("-old")).toContain("bg-diff-del-line");
    expect(lineClasses(" context")).toBe(
      "border-l-2 border-l-transparent px-3 text-fg-muted",
    );
  });
});
