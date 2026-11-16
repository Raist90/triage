import { describe, expect, test } from "bun:test";
import { makeFile } from "../../test/fixtures";
import { selectDiffFiles, summaryText } from "./diffSelection";

function review(band: "high" | "medium" | "low", score: number) {
  return { band, score, changes: {}, signals: {} };
}

describe("selectDiffFiles", () => {
  test("priority order puts high focus first and keeps patch order on ties", () => {
    const files = [
      makeFile({ path: "src/a.ts" }),
      makeFile({ path: "src/b.ts", review: review("high", 90) }),
      makeFile({ path: "src/c.ts", review: review("medium", 50) }),
    ];

    const selection = selectDiffFiles(files, {
      hiddenKinds: [],
      hideCosmetic: false,
      hideLowPriority: false,
      sort: "priority",
    });

    expect(selection.visible.map(({ file }) => file.path)).toEqual([
      "src/b.ts",
      "src/c.ts",
      "src/a.ts",
    ]);
    expect(selection.highCount).toBe(1);
    expect(selection.firstVisibleKey).toBe("src/b.ts:1");
  });

  test("path order restores patch order", () => {
    const files = [
      makeFile({ path: "src/a.ts" }),
      makeFile({ path: "src/b.ts", review: review("high", 90) }),
    ];

    const selection = selectDiffFiles(files, {
      hiddenKinds: [],
      hideCosmetic: false,
      hideLowPriority: false,
      sort: "path",
    });

    expect(selection.visible.map(({ file }) => file.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("hidden kinds leave the visible list and count toward hiddenCount", () => {
    const files = [
      makeFile({ path: "src/a.test.ts", kinds: ["test"] }),
      makeFile({ path: "src/a.ts" }),
    ];

    const selection = selectDiffFiles(files, {
      hiddenKinds: ["test"],
      hideCosmetic: false,
      hideLowPriority: false,
      sort: "priority",
    });

    expect(selection.kindCounts.test).toBe(1);
    expect(selection.kindFiltered.map(({ path }) => path)).toEqual([
      "src/a.ts",
    ]);
    expect(selection.visible.map(({ file }) => file.path)).toEqual([
      "src/a.ts",
    ]);
    expect(selection.hiddenByKind).toBe(1);
    expect(selection.hiddenCount).toBe(1);
  });

  test("hideCosmetic removes cosmetic-only files and counts them", () => {
    const files = [
      makeFile({
        path: "src/style.css",
        semantic: [
          {
            changeType: "modified",
            entityType: "rule",
            entityName: ".a",
            cosmetic: true,
          },
        ],
      }),
      makeFile({ path: "src/a.ts" }),
    ];

    const selection = selectDiffFiles(files, {
      hiddenKinds: [],
      hideCosmetic: true,
      hideLowPriority: false,
      sort: "priority",
    });

    expect(selection.cosmeticFiles).toBe(1);
    expect(selection.hiddenCount).toBe(1);
    expect(selection.visible.map(({ file }) => file.path)).toEqual([
      "src/a.ts",
    ]);
  });

  test("hideLowPriority removes low-band files and counts them", () => {
    const files = [
      makeFile({ path: "src/a.ts", review: review("low", 10) }),
      makeFile({ path: "src/b.ts", review: review("high", 90) }),
    ];

    const selection = selectDiffFiles(files, {
      hiddenKinds: [],
      hideCosmetic: false,
      hideLowPriority: true,
      sort: "priority",
    });

    expect(selection.lowCount).toBe(1);
    expect(selection.hiddenCount).toBe(1);
    expect(selection.visible.map(({ file }) => file.path)).toEqual([
      "src/b.ts",
    ]);
  });
});

describe("summaryText", () => {
  test("names only nonzero change types", () => {
    expect(
      summaryText({
        added: 1,
        modified: 2,
        deleted: 0,
        moved: 0,
        renamed: 0,
        reordered: 0,
        binary: 0,
        fileCount: 1,
        orphan: 0,
        total: 3,
      }),
    ).toBe("3 semantic changes · 1 added · 2 modified");
  });

  test("uses singular copy for one change and keeps a zero total readable", () => {
    expect(
      summaryText({
        added: 1,
        modified: 0,
        deleted: 0,
        moved: 0,
        renamed: 0,
        reordered: 0,
        binary: 0,
        fileCount: 1,
        orphan: 0,
        total: 1,
      }),
    ).toBe("1 semantic change · 1 added");

    expect(
      summaryText({
        added: 0,
        modified: 0,
        deleted: 0,
        moved: 0,
        renamed: 0,
        reordered: 0,
        binary: 0,
        fileCount: 0,
        orphan: 0,
        total: 0,
      }),
    ).toBe("0 semantic changes");
  });
});
