import { describe, expect, test } from "bun:test";
import type { SemanticChange } from "../../lib/types";
import {
  badgeClassName,
  changeMark,
  changeTitle,
  complexityLines,
  isCosmetic,
  tallyChanges,
  tallyText,
  tickClassName,
} from "./semantics";

function change(partial: Partial<SemanticChange> = {}): SemanticChange {
  return {
    changeType: "modified",
    entityType: "function",
    entityName: "run",
    ...partial,
  };
}

describe("changeMark", () => {
  test("maps each semantic change to its badge", () => {
    expect(changeMark(change({ changeType: "added" })).mark).toBe("A");
    expect(changeMark(change({ changeType: "deleted" })).mark).toBe("D");
  });

  test("falls back for an unknown change type", () => {
    const mark = changeMark(change({ changeType: "teleported" }));
    expect(mark.mark).toBe("•");
    expect(mark.label).toBe("changed");
  });

  test("cosmetic changes lose their signal color", () => {
    const cosmetic = change({ changeType: "deleted", cosmetic: true });
    expect(isCosmetic(cosmetic)).toBe(true);
    expect(tickClassName(cosmetic)).toBe("bg-fg-faint");
    expect(badgeClassName(cosmetic)).toContain("text-fg-faint");
  });
});

describe("tallyChanges", () => {
  test("counts types and picks the highest-signal dominant change", () => {
    const tally = tallyChanges([
      change({ changeType: "modified" }),
      change({ changeType: "deleted" }),
      change({ changeType: "added" }),
    ]);
    expect(tally.total).toBe(3);
    expect(tally.counts).toEqual({ modified: 1, deleted: 1, added: 1 });
    expect(tally.dominant.changeType).toBe("deleted");
  });

  test("cosmetic changes never become dominant", () => {
    const tally = tallyChanges([
      change({ changeType: "modified" }),
      change({ changeType: "deleted", cosmetic: true }),
    ]);
    expect(tally.dominant.changeType).toBe("modified");
  });

  test("renders counts in signal order", () => {
    const tally = tallyChanges([
      change({ changeType: "added" }),
      change({ changeType: "modified" }),
      change({ changeType: "modified" }),
    ]);
    expect(tallyText(tally)).toBe("1 added, 2 modified");
  });
});

describe("changeTitle", () => {
  test("packs entity, source file and line range into one line", () => {
    expect(
      changeTitle(
        change({
          changeType: "moved",
          oldFilePath: "src/old.ts",
          startLine: 4,
          endLine: 6,
        }),
        "src/new.ts",
      ),
    ).toBe("moved function run from src/old.ts · src/new.ts:4-6");
  });

  test("marks a cosmetic change and names a renamed entity", () => {
    expect(
      changeTitle(
        change({
          changeType: "renamed",
          oldEntityName: "oldRun",
          cosmetic: true,
        }),
        "src/app.ts",
      ),
    ).toBe("renamed function run was oldRun · src/app.ts · cosmetic");
  });
});

describe("complexityLines", () => {
  test("summarizes size and at most two drivers", () => {
    expect(
      complexityLines({
        band: "high",
        score: 88,
        changes: 12,
        sourceFiles: 3,
        deletes: 1,
        rewrites: 4,
        ripples: 2,
      }),
    ).toEqual(["3 source files · 12 changes", "1 delete · 4 rewrites"]);
  });

  test("omits the driver line when nothing drives complexity", () => {
    expect(
      complexityLines({
        band: "low",
        score: 4,
        changes: 1,
        sourceFiles: 1,
        deletes: 0,
        rewrites: 0,
      }),
    ).toEqual(["1 source file · 1 change"]);
  });
});
