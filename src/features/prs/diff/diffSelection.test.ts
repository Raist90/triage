import { describe, expect, test } from "bun:test";
import { makeFile } from "../../../test/fixtures";
import {
  diffSummaryParts,
  filesSummary,
  filterDiffEntries,
  selectDiffFiles,
  stepsSummary,
  summaryText,
  type DiffSelection,
} from "./diffSelection";

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

describe("filterDiffEntries", () => {
  test("matches paths case-insensitively and keeps the prepared order", () => {
    const entries = ["src/Alpha.ts", "src/beta.ts", "src/alphabet.md"].map(
      (path, index) => ({
        file: makeFile({ path }),
        index,
        key: `${path}:${index}`,
      }),
    );

    expect(filterDiffEntries(entries, " ALPHA ").map(({ key }) => key)).toEqual(
      ["src/Alpha.ts:0", "src/alphabet.md:2"],
    );
    expect(filterDiffEntries(entries, "")).toBe(entries);
    expect(filterDiffEntries(entries, "missing")).toEqual([]);
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

describe("filesSummary", () => {
  test("counts total files and singularizes one", () => {
    expect(filesSummary(1, 1, 0, 0)).toBe("1 file");
    expect(filesSummary(4, 4, 0, 0)).toBe("4 files");
  });

  test("shows visible of total with hidden and high counts", () => {
    expect(filesSummary(2, 5, 3, 0)).toBe("2 of 5 files · 3 hidden");
    expect(filesSummary(2, 5, 3, 1)).toBe("2 of 5 files · 3 hidden · 1 high");
    expect(filesSummary(4, 4, 0, 2)).toBe("4 files · 2 high");
  });
});

describe("stepsSummary", () => {
  test("singularizes one step", () => {
    expect(stepsSummary(1)).toBe("1 step · every change covered");
    expect(stepsSummary(3)).toBe("3 steps · every change covered");
  });
});

describe("diffSummaryParts", () => {
  const emptySelection = selectDiffFiles([], {
    hiddenKinds: [],
    hideCosmetic: false,
    hideLowPriority: false,
    sort: "priority",
  });

  function selectionWith(overrides: Partial<DiffSelection>): DiffSelection {
    return { ...emptySelection, ...overrides };
  }

  test("orders step, semantic summary and every visible count", () => {
    const parts = diffSummaryParts({
      summary: {
        added: 0,
        modified: 4,
        deleted: 0,
        moved: 0,
        renamed: 0,
        reordered: 0,
        binary: 0,
        fileCount: 4,
        orphan: 0,
        total: 4,
      },
      showSummary: true,
      selection: selectionWith({
        highCount: 5,
        cosmeticFiles: 2,
        hiddenByKind: 1,
        lowCount: 3,
      }),
      hideLowPriority: true,
      pathMode: true,
      stepLabel: "Step 1 of 2 · rename",
    });

    expect(parts.map((part) => part.key)).toEqual([
      "step",
      "summary",
      "high",
      "cosmetic",
      "hidden",
      "low",
    ]);
    expect(parts.map((part) => part.text)).toEqual([
      "Step 1 of 2 · rename",
      "4 semantic changes · 4 modified",
      "5 high focus",
      "2 cosmetic-only files",
      "1 file hidden",
      "3 low focus hidden",
    ]);
  });

  test("keeps hidden kinds without low focus, then adds low focus when hiding", () => {
    const selection = selectionWith({
      cosmeticFiles: 1,
      hiddenByKind: 2,
      lowCount: 3,
    });

    const visibleOnly = diffSummaryParts({
      showSummary: false,
      selection,
      hideLowPriority: false,
      pathMode: false,
    });
    expect(visibleOnly.map((part) => part.text)).toEqual([
      "1 cosmetic-only file",
      "2 files hidden",
    ]);

    const hiding = diffSummaryParts({
      showSummary: false,
      selection,
      hideLowPriority: true,
      pathMode: false,
    });
    expect(hiding.map((part) => part.text)).toEqual([
      "1 cosmetic-only file",
      "2 files hidden",
      "3 low focus hidden",
    ]);
  });
});
