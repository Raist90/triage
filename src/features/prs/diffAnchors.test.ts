import { describe, expect, test } from "bun:test";
import { makeInlineComment, makeLine } from "../../test/fixtures";
import {
  anchorKey,
  groupCommentsByAnchor,
  lineAnchor,
  lineAnchors,
} from "./diffAnchors";

describe("line anchors", () => {
  test("a deleted line anchors left to its old number", () => {
    const line = makeLine({ kind: "del", oldNumber: 7, text: "-old" });
    expect(lineAnchor("src/a.ts", line)).toEqual({
      path: "src/a.ts",
      side: "LEFT",
      line: 7,
    });
  });

  test("an added line anchors right to its new number", () => {
    const line = makeLine({ kind: "add", newNumber: 9, text: "+new" });
    expect(lineAnchor("src/a.ts", line)).toEqual({
      path: "src/a.ts",
      side: "RIGHT",
      line: 9,
    });
  });

  test("a numbered line without a matching side has no anchor", () => {
    expect(
      lineAnchor("src/a.ts", makeLine({ kind: "del", newNumber: 7, text: "" })),
    ).toBeNull();
    expect(
      lineAnchor("src/a.ts", makeLine({ kind: "add", oldNumber: 7, text: "" })),
    ).toBeNull();
  });

  test("a context line is reachable from both sides, left first", () => {
    const line = makeLine({
      kind: "context",
      oldNumber: 3,
      newNumber: 4,
      text: "same",
    });
    expect(lineAnchors("src/a.ts", line)).toEqual([
      { path: "src/a.ts", side: "LEFT", line: 3 },
      { path: "src/a.ts", side: "RIGHT", line: 4 },
    ]);
  });
});

describe("comment grouping", () => {
  test("keeps only comments on this file, this commit and a real line", () => {
    const comments = [
      makeInlineComment({ id: 1, path: "src/a.ts", line: 2 }),
      makeInlineComment({ id: 2, path: "src/b.ts", line: 2 }),
      makeInlineComment({
        id: 3,
        path: "src/a.ts",
        commitID: "older",
        line: 2,
      }),
      makeInlineComment({ id: 4, path: "src/a.ts", line: undefined }),
      makeInlineComment({
        id: 5,
        path: "src/a.ts",
        line: 2,
        side: "SIDE" as never,
      }),
    ];

    const groups = groupCommentsByAnchor(
      comments,
      "src/a.ts",
      "abc1234def5678",
    );

    expect(groups.size).toBe(1);
    expect(
      groups.get(anchorKey({ path: "src/a.ts", side: "RIGHT", line: 2 })),
    ).toEqual([makeInlineComment({ id: 1, path: "src/a.ts", line: 2 })]);
  });

  test("orders comments on the same anchor oldest first", () => {
    const later = makeInlineComment({
      id: 2,
      createdAt: "2026-06-15T12:00:00Z",
    });
    const earlier = makeInlineComment({
      id: 1,
      createdAt: "2026-06-15T11:00:00Z",
    });

    const groups = groupCommentsByAnchor(
      [later, earlier],
      "src/app.ts",
      "abc1234def5678",
    );
    const bucket = groups.get(
      anchorKey({ path: "src/app.ts", side: "RIGHT", line: 2 }),
    );

    expect(bucket?.map((comment) => comment.id)).toEqual([1, 2]);
  });
});
