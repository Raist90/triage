import { describe, expect, test } from "bun:test";
import type { WalkthroughStep } from "../../../lib/types";
import { makeFile } from "../../../test/fixtures";
import { pathEntries } from "./walkthrough";

function step(files: WalkthroughStep["files"]): WalkthroughStep {
  return {
    id: "step-1",
    title: "Step",
    additions: 0,
    deletions: 0,
    files,
  };
}

describe("pathEntries", () => {
  test("resolves a step to the loaded files and keeps first-appearance order", () => {
    const files = [
      makeFile({ path: "src/a.ts" }),
      makeFile({ path: "src/b.ts" }),
    ];
    const entries = pathEntries(
      files,
      step([
        { path: "src/b.ts", hunks: [1] },
        { path: "src/a.ts", hunks: [0] },
      ]),
    );

    expect(entries.map((entry) => entry.file.path)).toEqual([
      "src/b.ts",
      "src/a.ts",
    ]);
    expect(entries[0].hunks).toEqual([1]);
    expect(entries[1].hunks).toEqual([0]);
  });

  test("matches the old path of a renamed file", () => {
    const files = [makeFile({ path: "src/new.ts", oldPath: "src/old.ts" })];
    const entries = pathEntries(
      files,
      step([{ path: "src/old.ts", hunks: [0] }]),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].file.path).toBe("src/new.ts");
  });

  test("skips a file the diff no longer contains", () => {
    const entries = pathEntries(
      [makeFile({ path: "src/a.ts" })],
      step([{ path: "src/missing.ts", hunks: [0] }]),
    );

    expect(entries).toEqual([]);
  });
});
