import { describe, expect, test } from "bun:test";
import { parsePRKey } from "./pr";

describe("parsePRKey", () => {
  test("splits owner/name from the PR number", () => {
    expect(parsePRKey("acme/web#42")).toEqual({ repo: "acme/web", number: 42 });
  });

  test("uses the last hash so a repo segment may contain one", () => {
    expect(parsePRKey("acme/web#ui#7")).toEqual({
      repo: "acme/web#ui",
      number: 7,
    });
  });

  test.each([
    ["missing number", "acme/web#"],
    ["missing hash", "acme/web"],
    ["missing repo", "#42"],
    ["non-numeric number", "acme/web#abc"],
    ["fractional number", "acme/web#4.2"],
    ["zero number", "acme/web#0"],
    ["negative number", "acme/web#-1"],
    ["repo without owner", "web#42"],
  ])("rejects %s", (_label, value) => {
    expect(parsePRKey(value)).toBeNull();
  });
});
