import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useUIStore } from "../../../stores/ui";
import type { Walkthrough } from "../../../lib/types";
import {
  makeCommentsController,
  makeFile,
  makeHunk,
  makeInlineComment,
  makeLine,
} from "../../../test/fixtures";
import type { DiffCommentsController } from "./useDiffComments";
import { DiffView } from "./DiffView";

const initialUIState = useUIStore.getState();

beforeEach(() => {
  useUIStore.setState(initialUIState, true);
  useUIStore.setState({ diffSidebarWidth: 208 });
});

afterEach(() => {
  useUIStore.setState({ diffSidebarWidth: 208 });
});

const headSHA = "abc1234def5678";

function fileA() {
  return makeFile({
    path: "src/a.ts",
    hunks: [
      makeHunk({
        header: "@@ -1,2 +1,2 @@",
        lines: [
          makeLine({
            kind: "context",
            oldNumber: 1,
            newNumber: 1,
            text: "shared context",
          }),
          makeLine({ kind: "add", newNumber: 2, text: "alpha added" }),
        ],
      }),
    ],
  });
}

function fileB() {
  return makeFile({
    path: "src/b.ts",
    hunks: [
      makeHunk({
        header: "@@ -1,2 +1,2 @@",
        lines: [
          makeLine({
            kind: "context",
            oldNumber: 1,
            newNumber: 1,
            text: "beta context",
          }),
          makeLine({ kind: "add", newNumber: 2, text: "beta added" }),
        ],
      }),
    ],
  });
}

function mockPaneGeometry(
  pane: HTMLElement,
  heights: number[],
  geometry: { scrollTop: number; clientHeight: number; scrollHeight: number },
) {
  const { scrollTop, clientHeight, scrollHeight } = geometry;
  Object.defineProperties(pane, {
    scrollTop: { value: scrollTop, configurable: true },
    clientHeight: { value: clientHeight, configurable: true },
    scrollHeight: { value: scrollHeight, configurable: true },
  });
  Object.defineProperty(pane, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 0, bottom: clientHeight }),
  });
  let top = -scrollTop;
  for (const [index, section] of Array.from(
    pane.querySelectorAll("section"),
  ).entries()) {
    const sectionTop = top;
    const bottom = sectionTop + heights[index];
    Object.defineProperty(section, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: sectionTop, bottom }),
    });
    top = bottom;
  }
}

function renderDiff(
  overrides: {
    files?: ReturnType<typeof makeFile>[];
    canComment?: boolean;
    focusTarget?: { path: string; line?: number; token: number };
    comments?: DiffCommentsController;
    semantic?: boolean;
    walkthrough?: Walkthrough;
    mode?: "files" | "path";
  } = {},
) {
  const files = overrides.files ?? [fileA(), fileB()];
  if (overrides.mode) {
    useUIStore.setState({ diffMode: overrides.mode });
  }
  return render(
    <DiffView
      files={files}
      semanticAvailable={overrides.semantic ?? false}
      semanticSummary={undefined}
      walkthrough={overrides.walkthrough}
      comments={overrides.comments ?? makeCommentsController()}
      headSHA={headSHA}
      canComment={overrides.canComment ?? false}
      viewerLogin="viewer"
      focusTarget={overrides.focusTarget}
    />,
  );
}

describe("DiffView", () => {
  test("opens the first file and keeps the rest collapsed", () => {
    renderDiff();
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();
  });

  test("selecting a file in the sidebar expands it and collapses the previous one", () => {
    renderDiff();
    const sidebar = screen.getByLabelText("Files in this pull request");

    fireEvent.click(within(sidebar).getByRole("button", { name: /b\.ts/ }));

    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
  });

  test("j moves the keyboard selection to the next file", () => {
    renderDiff();
    fireEvent.keyDown(window, { key: "j" });

    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
  });

  test("the file filter narrows the sidebar without closing the open file", () => {
    renderDiff();
    const sidebar = screen.getByLabelText("Files in this pull request");

    fireEvent.change(within(sidebar).getByLabelText("Filter files"), {
      target: { value: "b.ts" },
    });

    expect(within(sidebar).queryByText("a.ts")).toBeNull();
    expect(within(sidebar).getByText("b.ts")).toBeDefined();
    expect(within(sidebar).getByText(/1 of 2 files/)).toBeDefined();
    expect(screen.getByText("alpha added")).toBeDefined();
  });

  test("the file filter also narrows keyboard navigation", () => {
    renderDiff({ files: [fileA(), fileB(), makeFile({ path: "src/c.ts" })] });
    const sidebar = screen.getByLabelText("Files in this pull request");

    fireEvent.change(within(sidebar).getByLabelText("Filter files"), {
      target: { value: "a.ts" },
    });
    fireEvent.keyDown(window, { key: "j" });

    const current = sidebar.querySelector('[aria-current="location"]');
    expect(current?.textContent).toContain("a.ts");
  });

  test("the file rail separator resizes by keyboard and resets on double-click", () => {
    renderDiff();
    const separator = screen.getByRole("separator");

    expect(separator.getAttribute("aria-valuenow")).toBe("208");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator.getAttribute("aria-valuenow")).toBe("216");

    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator.getAttribute("aria-valuenow")).toBe("168");

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator.getAttribute("aria-valuenow")).toBe("440");

    fireEvent.doubleClick(separator);
    expect(separator.getAttribute("aria-valuenow")).toBe("208");
  });

  test("a review finding jump opens the target file", () => {
    renderDiff({ focusTarget: { path: "src/b.ts", line: 2, token: 1 } });

    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
  });

  test("the comment composer anchors to the clicked line and head commit", async () => {
    let submitted: Parameters<DiffCommentsController["submit"]>[0] | null =
      null;
    const comments = makeCommentsController({
      submit: async (input) => {
        submitted = input;
        return null;
      },
    });
    renderDiff({ canComment: true, comments });

    const lineButtons = screen.getAllByRole("button", {
      name: "Comment on this line",
    });
    fireEvent.click(lineButtons[1]);

    fireEvent.change(
      screen.getByPlaceholderText("Leave a comment on this line…"),
      {
        target: { value: "Please extract this." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(submitted).toEqual({
        body: "Please extract this.",
        path: "src/a.ts",
        line: 2,
        side: "RIGHT",
        commitId: headSHA,
      }),
    );
    expect(
      screen.queryByPlaceholderText("Leave a comment on this line…"),
    ).toBeNull();
  });

  test("renders existing comments on the matching side and line", () => {
    const comments = makeCommentsController({
      comments: [
        {
          id: 7,
          author: "octocat",
          body: "Existing thread",
          commitID: headSHA,
          createdAt: "2026-06-15T11:50:00Z",
          path: "src/a.ts",
          side: "RIGHT",
          line: 2,
        },
      ],
    });
    renderDiff({ comments });

    expect(screen.getByText("Existing thread")).toBeDefined();
  });

  test("semantic changes appear in a hunk chip on demand, not as always-on rows", () => {
    const file = fileA();
    file.semantic = [
      {
        changeType: "added",
        entityType: "function",
        entityName: "checkout",
        startLine: 2,
        endLine: 2,
      },
    ];
    renderDiff({ files: [file], semantic: true });

    expect(screen.queryByText("checkout")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "1 added in this hunk" }),
    );
    expect(screen.getByText("checkout")).toBeDefined();
  });

  test("falls back to a raw patch when the server did not structure a file", () => {
    const raw = makeFile({
      path: "src/raw.txt",
      hunks: [],
      patch: "@@ -1 +1 @@\n-old line\n+new line",
    });
    renderDiff({ files: [raw] });

    expect(screen.getByText(/@@ -1 \+1 @@/)).toBeDefined();
    expect(screen.getByText(/\+new line/)).toBeDefined();
  });

  test("k moves back, and the first file does not wrap", () => {
    renderDiff();

    fireEvent.keyDown(window, { key: "j" });
    expect(screen.getByText("beta added")).toBeDefined();

    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByText("alpha added")).toBeDefined();

    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();
  });

  test("slash focuses the file filter", () => {
    renderDiff();

    fireEvent.keyDown(window, { key: "/" });

    expect(document.activeElement).toBe(screen.getByLabelText("Filter files"));
  });

  test("focus mode can open every file and return to one at a time", () => {
    renderDiff();

    fireEvent.click(screen.getByRole("button", { name: "Show all files" }));
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.getByText("beta added")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Show one file at a time" }),
    );
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();
  });

  test("the file header collapses and reopens its patch", () => {
    renderDiff();
    const section = screen.getByText("alpha added").closest("section");
    expect(section).not.toBeNull();
    const header = within(section!).getByRole("button", { name: /a\.ts/ });

    fireEvent.click(header);
    expect(screen.queryByText("alpha added")).toBeNull();

    fireEvent.click(header);
    expect(screen.getByText("alpha added")).toBeDefined();
  });

  test("a hidden file kind leaves the list and can be cleared again", () => {
    const a = fileA();
    a.kinds = ["test"];
    renderDiff({ files: [a, fileB()] });
    const sidebar = screen.getByLabelText("Files in this pull request");

    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: "Tests, 1 file, shown",
      }),
    );

    expect(within(sidebar).queryByText("a.ts")).toBeNull();
    expect(screen.queryByText("alpha added")).toBeNull();
    expect(screen.getByText(/1 file hidden/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(within(sidebar).getByText("a.ts")).toBeDefined();
    expect(within(sidebar).getByText("2 files")).toBeDefined();
  });

  test("cosmetic-only files are hidden by default and can be shown", () => {
    const a = fileA();
    a.semantic = [
      {
        changeType: "modified",
        entityType: "rule",
        entityName: ".a",
        cosmetic: true,
      },
    ];
    renderDiff({ files: [a, fileB()] });
    const sidebar = screen.getByLabelText("Files in this pull request");

    expect(within(sidebar).queryByText("a.ts")).toBeNull();
    expect(screen.getByText(/1 cosmetic-only file/)).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide cosmetic-only files" }),
    );
    expect(within(sidebar).getByText("a.ts")).toBeDefined();
  });

  test("low-focus files can be hidden and are named in the toolbar", () => {
    const a = fileA();
    a.review = { band: "low", score: 10, changes: {}, signals: {} };
    const b = fileB();
    b.review = { band: "high", score: 90, changes: {}, signals: {} };
    renderDiff({ files: [a, b] });
    const sidebar = screen.getByLabelText("Files in this pull request");

    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: "Low focus, 1 file, shown",
      }),
    );

    expect(within(sidebar).queryByText("a.ts")).toBeNull();
    expect(screen.getByText(/1 low focus hidden/)).toBeDefined();
  });

  test("the sort choice is a radio group and arrow keys move it", () => {
    const a = fileA();
    a.review = { band: "low", score: 10, changes: {}, signals: {} };
    renderDiff({ files: [a, fileB()] });
    const group = screen.getByRole("radiogroup", { name: "Sort diff files" });
    const priority = within(group).getByRole("radio", { name: "Priority" });

    expect(priority.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(priority, { key: "ArrowRight" });

    expect(
      within(group)
        .getByRole("radio", { name: "Path" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  test("binary files and empty patches have their own copy", () => {
    const binary = makeFile({
      path: "src/logo.png",
      binary: true,
      hunks: [],
    });
    const { unmount } = renderDiff({ files: [binary] });
    expect(screen.getByText("Binary file changed.")).toBeDefined();
    unmount();

    const empty = makeFile({ path: "src/empty.txt", hunks: [], patch: "" });
    renderDiff({ files: [empty] });
    expect(screen.getByText("No textual changes.")).toBeDefined();
  });

  test("unanchored semantic changes stay collapsed until asked for", () => {
    const file = fileA();
    file.semantic = [
      {
        changeType: "modified",
        entityType: "function",
        entityName: "orphan",
        startLine: 50,
        endLine: 50,
      },
    ];
    renderDiff({ files: [file], semantic: true });

    expect(screen.queryByText("orphan")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /unanchored semantic change/ }),
    );
    expect(screen.getByText("orphan")).toBeDefined();
  });

  test("the author can delete their inline comment after confirming", async () => {
    let removed: number | null = null;
    const comments = makeCommentsController({
      comments: [
        makeInlineComment({
          id: 7,
          author: "viewer",
          body: "Existing thread",
          path: "src/a.ts",
          line: 2,
          side: "RIGHT",
          commitID: headSHA,
        }),
      ],
      remove: async (id) => {
        removed = id;
        return null;
      },
    });
    renderDiff({ comments });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));

    await waitFor(() => expect(removed).toBe(7));
  });

  test("a failed delete keeps the thread and shows the error", async () => {
    const comments = makeCommentsController({
      comments: [
        makeInlineComment({
          id: 7,
          author: "viewer",
          body: "Existing thread",
          path: "src/a.ts",
          line: 2,
          side: "RIGHT",
          commitID: headSHA,
        }),
      ],
      remove: async () => "Could not delete",
    });
    renderDiff({ comments });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not delete");
    expect(screen.getByText("Existing thread")).toBeDefined();
  });

  test("Escape closes the composer without submitting", () => {
    const comments = makeCommentsController({
      submit: async () => {
        throw new Error("must not submit");
      },
    });
    renderDiff({ canComment: true, comments });

    fireEvent.click(
      screen.getAllByRole("button", { name: "Comment on this line" })[1],
    );
    const composer = screen.getByPlaceholderText(
      "Leave a comment on this line…",
    );
    fireEvent.change(composer, { target: { value: "Draft" } });
    fireEvent.keyDown(composer, { key: "Escape" });

    expect(
      screen.queryByPlaceholderText("Leave a comment on this line…"),
    ).toBeNull();
  });

  test("the last file owns the selection when the pane is clamped at the bottom", async () => {
    const names = ["a", "b", "c", "d", "e"];
    const files = names.map((name) =>
      makeFile({
        path: `src/${name}.ts`,
        hunks: [
          makeHunk({
            lines: [
              makeLine({ kind: "add", newNumber: 1, text: `${name} added` }),
            ],
          }),
        ],
      }),
    );
    renderDiff({ files });
    fireEvent.click(screen.getByRole("button", { name: "Show all files" }));

    const pane = screen.getByText("a added").closest("section")!
      .parentElement as HTMLElement;
    // 400 + 300 + 200 + 60 + 40px of content, scrolled to the end. The top
    // edge sits inside b.ts, but the viewport shows d.ts and e.ts below it.
    mockPaneGeometry(pane, [400, 300, 200, 60, 40], {
      scrollTop: 500,
      clientHeight: 500,
      scrollHeight: 1000,
    });

    fireEvent.scroll(pane);

    const sidebar = screen.getByLabelText("Files in this pull request");
    await waitFor(() =>
      expect(
        within(sidebar)
          .getByRole("button", { name: /e\.ts/ })
          .getAttribute("aria-current"),
      ).toBe("location"),
    );
  });

  test("a collapsed trailing file owns the selection at the bottom", async () => {
    const names = ["a", "b", "c", "d", "e"];
    const files = names.map((name) =>
      makeFile({
        path: `src/${name}.ts`,
        hunks: [
          makeHunk({
            lines: [
              makeLine({ kind: "add", newNumber: 1, text: `${name} added` }),
            ],
          }),
        ],
      }),
    );
    // Only the first file is open; b.ts through e.ts are 36px headers.
    renderDiff({ files });

    const pane = screen.getByText("a added").closest("section")!
      .parentElement as HTMLElement;
    mockPaneGeometry(pane, [400, 300, 200, 60, 40], {
      scrollTop: 500,
      clientHeight: 500,
      scrollHeight: 1000,
    });

    fireEvent.scroll(pane);

    const sidebar = screen.getByLabelText("Files in this pull request");
    await waitFor(() =>
      expect(
        within(sidebar)
          .getByRole("button", { name: /e\.ts/ })
          .getAttribute("aria-current"),
      ).toBe("location"),
    );
  });

  test("a failed submit keeps the composer open with the error", async () => {
    const comments = makeCommentsController({
      submit: async () => "Could not post",
    });
    renderDiff({ canComment: true, comments });

    fireEvent.click(
      screen.getAllByRole("button", { name: "Comment on this line" })[1],
    );
    fireEvent.change(
      screen.getByPlaceholderText("Leave a comment on this line…"),
      {
        target: { value: "Please extract this." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not post");
    expect(
      screen.getByPlaceholderText("Leave a comment on this line…"),
    ).toBeDefined();
  });

  test("path mode shows only the active step and switches steps from the rail", () => {
    const walkthrough: Walkthrough = {
      steps: [
        {
          id: "step-1",
          title: "Change a",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/a.ts", hunks: [0] }],
        },
        {
          id: "step-2",
          title: "Change b",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/b.ts", hunks: [0] }],
        },
      ],
    };
    renderDiff({ mode: "path", walkthrough });

    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();

    const rail = screen.getByLabelText("Review path");
    fireEvent.click(within(rail).getByRole("button", { name: /Change b/ }));

    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
  });

  test("the rail marks the open file and the open step as current", () => {
    const walkthrough: Walkthrough = {
      steps: [
        {
          id: "step-1",
          title: "Change a",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/a.ts", hunks: [0] }],
        },
        {
          id: "step-2",
          title: "Change b",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/b.ts", hunks: [0] }],
        },
      ],
    };
    renderDiff({ walkthrough, mode: "path" });

    const rail = screen.getByLabelText("Review path");
    expect(
      within(rail)
        .getByRole("button", { name: /Change a/ })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(
      within(rail)
        .getByRole("button", { name: /Change b/ })
        .getAttribute("aria-current"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show the file list" }));

    const files = screen.getByLabelText("Files in this pull request");
    expect(
      within(files)
        .getByRole("button", { name: /a\.ts/ })
        .getAttribute("aria-current"),
    ).toBe("location");
    expect(
      within(files)
        .getByRole("button", { name: /b\.ts/ })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  test("path mode renders only the hunks a step owns", () => {
    const file = makeFile({
      path: "src/a.ts",
      hunks: [
        makeHunk({
          header: "@@ -1,1 +1,2 @@",
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 2,
          lines: [
            makeLine({
              kind: "context",
              oldNumber: 1,
              newNumber: 1,
              text: "first context",
            }),
            makeLine({ kind: "add", newNumber: 2, text: "first hunk" }),
          ],
        }),
        makeHunk({
          header: "@@ -10,1 +10,2 @@",
          oldStart: 10,
          oldCount: 1,
          newStart: 10,
          newCount: 2,
          lines: [
            makeLine({
              kind: "context",
              oldNumber: 10,
              newNumber: 10,
              text: "second context",
            }),
            makeLine({ kind: "add", newNumber: 11, text: "second hunk" }),
          ],
        }),
      ],
    });
    const walkthrough: Walkthrough = {
      steps: [
        {
          id: "step-1",
          title: "First hunk",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/a.ts", hunks: [0] }],
        },
      ],
    };
    renderDiff({ files: [file], mode: "path", walkthrough });

    expect(screen.getByText("first hunk")).toBeDefined();
    expect(screen.queryByText("second hunk")).toBeNull();
  });

  test("the toolbar toggles between the file list and the review path", () => {
    const walkthrough: Walkthrough = {
      steps: [
        {
          id: "step-1",
          title: "Only step",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/a.ts", hunks: [0] }],
        },
      ],
    };
    renderDiff({ walkthrough });
    expect(screen.getByLabelText("Files in this pull request")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Group files into steps" }),
    );
    expect(screen.getByLabelText("Review path")).toBeDefined();
    expect(screen.getByText(/Step 1 of 1 · Only step/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Show the file list" }));
    expect(screen.getByLabelText("Files in this pull request")).toBeDefined();
  });

  test("path mode opens a step's files together without a focus toggle", () => {
    const a = fileA();
    a.semantic = [
      {
        changeType: "added",
        entityType: "function",
        entityName: "checkout",
        startLine: 2,
        endLine: 2,
      },
    ];
    const walkthrough: Walkthrough = {
      steps: [
        {
          id: "step-1",
          title: "Both files",
          additions: 2,
          deletions: 0,
          files: [
            { path: "src/a.ts", hunks: [0] },
            { path: "src/b.ts", hunks: [0] },
          ],
        },
      ],
    };
    renderDiff({
      files: [a, fileB()],
      semantic: true,
      mode: "path",
      walkthrough,
    });

    expect(screen.getByLabelText("Semantic change map")).toBeDefined();
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Show all files" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show one file at a time" }),
    ).toBeNull();

    // Collapsing one file of the step must not collapse the other.
    const section = screen.getByText("alpha added").closest("section");
    expect(section).not.toBeNull();
    fireEvent.click(within(section!).getByRole("button", { name: /a\.ts/ }));

    expect(screen.queryByText("alpha added")).toBeNull();
    expect(screen.getByText("beta added")).toBeDefined();
  });

  test("j and k move between path steps and stop at the ends", () => {
    const walkthrough: Walkthrough = {
      steps: [
        {
          id: "step-1",
          title: "Change a",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/a.ts", hunks: [0] }],
        },
        {
          id: "step-2",
          title: "Change b",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/b.ts", hunks: [0] }],
        },
      ],
    };
    renderDiff({ mode: "path", walkthrough });

    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();

    fireEvent.keyDown(window, { key: "j" });
    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();

    fireEvent.keyDown(window, { key: "j" });
    expect(screen.getByText("beta added")).toBeDefined();

    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();

    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByText("alpha added")).toBeDefined();
  });
});
