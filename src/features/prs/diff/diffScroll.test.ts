import { describe, expect, test } from "bun:test";
import { activeSectionKey, clampedAtBottom } from "./diffScroll";

describe("clampedAtBottom", () => {
  test("is true when the last pixel is reached or nearly reached", () => {
    expect(
      clampedAtBottom({
        scrollTop: 500,
        clientHeight: 500,
        scrollHeight: 1000,
      }),
    ).toBe(true);
    expect(
      clampedAtBottom({
        scrollTop: 499,
        clientHeight: 500,
        scrollHeight: 1000,
      }),
    ).toBe(true);
  });

  test("is false while there is still content below the viewport", () => {
    expect(
      clampedAtBottom({
        scrollTop: 480,
        clientHeight: 500,
        scrollHeight: 1000,
      }),
    ).toBe(false);
  });

  test("is false when the content fits without scrolling", () => {
    expect(
      clampedAtBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 }),
    ).toBe(false);
  });
});

describe("activeSectionKey", () => {
  test("returns the section that contains the top edge", () => {
    expect(
      activeSectionKey(
        [
          { key: "a", top: -40, bottom: 10 },
          { key: "b", top: 11, bottom: 80 },
          { key: "c", top: 81, bottom: 140 },
        ],
        11,
      ),
    ).toBe("b");
  });

  test("returns the first section below when none contains the edge", () => {
    expect(
      activeSectionKey(
        [
          { key: "a", top: 40, bottom: 80 },
          { key: "b", top: 81, bottom: 140 },
        ],
        11,
      ),
    ).toBe("a");
  });

  test("returns the last section when the pane is clamped at the bottom", () => {
    expect(
      activeSectionKey(
        [
          { key: "a", top: -100, bottom: -20 },
          { key: "b", top: -19, bottom: -1 },
        ],
        11,
      ),
    ).toBe("b");
  });

  test("returns null when nothing is rendered", () => {
    expect(activeSectionKey([], 11)).toBeNull();
  });
});
