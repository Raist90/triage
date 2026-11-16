import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { PRStateTag } from "./PRStateTag";
import { prStatus } from "./prStatus";

describe("prStatus", () => {
  test("terminal states win over draft", () => {
    expect(prStatus({ state: "merged", isDraft: false })).toBe("merged");
    expect(prStatus({ state: "closed", isDraft: false })).toBe("closed");
    expect(prStatus({ state: "closed", isDraft: true })).toBe("closed");
  });

  test("open drafts read as draft, open PRs as open", () => {
    expect(prStatus({ state: "open", isDraft: true })).toBe("draft");
    expect(prStatus({ state: "open", isDraft: false })).toBe("open");
  });

  test("unknown states fall through to open", () => {
    expect(prStatus({ state: "", isDraft: false })).toBe("open");
  });
});

describe("PRStateTag", () => {
  test("merged is the only accented tag", () => {
    const { unmount } = render(<PRStateTag status="merged" />);
    expect(screen.getByText("Merged").className).toContain("text-accent");
    unmount();

    for (const status of ["closed", "draft"] as const) {
      const result = render(<PRStateTag status={status} />);
      expect(
        screen.getByText(status === "closed" ? "Closed" : "Draft").className,
      ).toContain("text-fg-faint");
      result.unmount();
    }
  });

  test("open renders no tag", () => {
    const { container } = render(<PRStateTag status="open" />);
    expect(container.textContent).toBe("");
  });
});
