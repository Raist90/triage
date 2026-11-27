import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useUIStore } from "../../../stores/ui";
import type { DiffFile, Walkthrough } from "../../../lib/types";
import {
  makeCommentsController,
  makeFile,
  makeHunk,
  makeInlineComment,
  makeLine,
  makePR,
} from "../../../test/fixtures";
import type { DiffCommentsController } from "./useDiffComments";
import { ReviewFindingsContext } from "./ReviewFindingsContext";
import { DiffView } from "./DiffView";

const initialUIState = useUIStore.getState();

beforeEach(() => {
  useUIStore.setState(initialUIState, true);
});

afterEach(() => {
  useUIStore.setState(initialUIState, true);
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
    files?: DiffFile[];
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
      pr={makePR({ headSHA })}
      files={files}
      semanticAvailable={overrides.semantic ?? false}
      walkthrough={overrides.walkthrough}
      comments={overrides.comments ?? makeCommentsController()}
      headSHA={headSHA}
      canComment={overrides.canComment ?? false}
      viewerLogin="viewer"
      focusTarget={overrides.focusTarget}
    />,
  );
}

function openFiles() {
  fireEvent.click(screen.getByRole("button", { name: /^Files/ }));
  return screen.getByRole("dialog", { name: "Diff files" });
}

describe("DiffView", () => {
  test("the strip owns the PR facts", () => {
    renderDiff();
    expect(screen.getByText("2 files")).toBeDefined();
    expect(screen.getByText("+12")).toBeDefined();
    expect(screen.getByText("−4")).toBeDefined();
    expect(screen.getByText("3 commits")).toBeDefined();
    expect(screen.getByText("Checks passing")).toBeDefined();
    expect(screen.getByText("abc1234")).toBeDefined();
  });

  test("opens the first file and keeps the rest collapsed", () => {
    renderDiff();
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();
  });

  test("j moves the keyboard selection to the next file header", () => {
    renderDiff();
    fireEvent.keyDown(window, { key: "j" });

    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
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

  test("slash opens the Files popover and focuses its filter", async () => {
    renderDiff();

    fireEvent.keyDown(window, { key: "/" });

    const dialog = screen.getByRole("dialog", { name: "Diff files" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByLabelText("Filter files"),
      ),
    );
  });

  test("the file filter narrows the popover without closing the open file", () => {
    renderDiff();
    const dialog = openFiles();

    fireEvent.change(within(dialog).getByLabelText("Filter files"), {
      target: { value: "b.ts" },
    });

    expect(within(dialog).queryByText("a.ts")).toBeNull();
    expect(within(dialog).getByText("b.ts")).toBeDefined();
    expect(within(dialog).getByText("1 of 2 files")).toBeDefined();
    expect(screen.getByText("alpha added")).toBeDefined();
  });

  test("selecting a file in the popover opens and collapses the previous one", () => {
    renderDiff();
    const dialog = openFiles();

    fireEvent.click(within(dialog).getByRole("button", { name: /b\.ts/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
  });

  test("a review finding jump opens the target file", () => {
    renderDiff({ focusTarget: { path: "src/b.ts", line: 2, token: 1 } });

    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
  });

  test("a review finding in another step switches to that step", () => {
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
    renderDiff({
      walkthrough,
      mode: "path",
      focusTarget: { path: "src/b.ts", line: 2, token: 1 },
    });

    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
  });

  test("a finding jump centres its thread in one-at-a-time mode", () => {
    const scrollIntoView = mock(() => {});
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(
        <ReviewFindingsContext
          value={{
            review: {
              findings: [
                {
                  id: "finding-1",
                  file: "src/b.ts",
                  line: 2,
                  severity: "warning",
                  category: "risk",
                  anchored: true,
                  claim: "The claim.",
                  title: "The finding",
                },
              ],
              verdict: { safeToMerge: true, summary: "Safe" },
            },
            stale: false,
          }}
        >
          <DiffView
            pr={makePR({ headSHA })}
            files={[fileA(), fileB()]}
            semanticAvailable={false}
            comments={makeCommentsController()}
            headSHA={headSHA}
            canComment={false}
            viewerLogin="viewer"
            focusTarget={{
              path: "src/b.ts",
              line: 2,
              findingID: "finding-1",
              token: 1,
            }}
          />
        </ReviewFindingsContext>,
      );

      expect(
        document.querySelector("[data-finding-id='finding-1']"),
      ).not.toBeNull();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("a published finding is replaced by its pending comment and the comment is the jump target", () => {
    const scrollIntoView = mock(() => {});
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const comments = makeCommentsController({
        comments: [
          makeInlineComment({
            id: 77,
            body: "Published body.",
            findingID: "finding-1",
            pending: true,
            path: "src/b.ts",
            line: 2,
          }),
        ],
      });
      render(
        <ReviewFindingsContext
          value={{
            review: {
              findings: [
                {
                  id: "finding-1",
                  file: "src/b.ts",
                  line: 2,
                  severity: "warning",
                  category: "risk",
                  anchored: true,
                  claim: "The claim.",
                  title: "The finding",
                },
              ],
              verdict: { safeToMerge: true, summary: "Safe" },
            },
            stale: false,
          }}
        >
          <DiffView
            pr={makePR({ headSHA })}
            files={[fileB()]}
            semanticAvailable={false}
            comments={comments}
            headSHA={headSHA}
            canComment={false}
            viewerLogin="viewer"
            focusTarget={{
              path: "src/b.ts",
              line: 2,
              commentID: 77,
              token: 1,
            }}
          />
        </ReviewFindingsContext>,
      );

      expect(screen.queryByText("The finding")).toBeNull();
      expect(screen.getByText("Published body.")).toBeDefined();
      expect(screen.getByText("Pending")).toBeDefined();
      expect(document.querySelector("[data-comment-id='77']")).not.toBeNull();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
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

  test("the inline-comment toggle hides threads without hiding code", () => {
    const comments = makeCommentsController({
      comments: [
        makeInlineComment({
          id: 7,
          author: "octocat",
          body: "Existing thread",
          path: "src/a.ts",
          line: 2,
          commitID: headSHA,
        }),
      ],
    });
    renderDiff({ comments });
    expect(screen.getByText("Existing thread")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide inline comments" }),
    );

    expect(screen.queryByText("Existing thread")).toBeNull();
    expect(screen.getByText("alpha added")).toBeDefined();
  });

  test("semantic changes appear in a hunk chip on demand", () => {
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

  test("a hidden file kind leaves the popover and can be cleared again", () => {
    const a = fileA();
    a.kinds = ["test"];
    renderDiff({ files: [a, fileB()] });
    const dialog = openFiles();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Tests, 1 file, shown",
      }),
    );

    expect(within(dialog).queryByText("a.ts")).toBeNull();
    expect(screen.queryByText("alpha added")).toBeNull();
    expect(within(dialog).getByText("1 hidden")).toBeDefined();

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(within(dialog).getByText("a.ts")).toBeDefined();
    expect(within(dialog).getByText("2 of 2 files")).toBeDefined();
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
    const dialog = openFiles();

    expect(within(dialog).queryByText("a.ts")).toBeNull();
    expect(within(dialog).getByText("1 cosmetic")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide cosmetic-only files" }),
    );
    expect(within(dialog).getByText("a.ts")).toBeDefined();
  });

  test("low-focus files can be hidden from the popover", () => {
    const a = fileA();
    a.review = { band: "low", score: 10, changes: {}, signals: {} };
    const b = fileB();
    b.review = { band: "high", score: 90, changes: {}, signals: {} };
    renderDiff({ files: [a, b] });
    const dialog = openFiles();

    fireEvent.click(within(dialog).getByRole("button", { name: /Low focus/ }));

    expect(within(dialog).queryByText("a.ts")).toBeNull();
    expect(within(dialog).getByText("1 of 2 files")).toBeDefined();
  });

  test("the sort choice is a radio group in the popover", () => {
    const a = fileA();
    a.review = { band: "low", score: 10, changes: {}, signals: {} };
    renderDiff({ files: [a, fileB()] });
    const dialog = openFiles();
    const group = within(dialog).getByRole("radiogroup", {
      name: "Sort diff files",
    });
    const priority = within(group).getByRole("radio", { name: "Priority" });

    expect(priority.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(within(group).getByRole("radio", { name: "Path" }));

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

  test("focus mode opens every file and returns to one at a time", () => {
    renderDiff();

    fireEvent.click(screen.getByRole("button", { name: /^Files/ }));
    fireEvent.click(screen.getByRole("button", { name: "One at a time" }));
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.getByText("beta added")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "One at a time" }));
    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();
  });

  test("path mode shows the active step and switches steps from the popover", () => {
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
    renderDiff({ walkthrough });
    let dialog = openFiles();
    fireEvent.click(within(dialog).getByRole("button", { name: "Steps" }));

    expect(screen.getByText("alpha added")).toBeDefined();
    expect(screen.queryByText("beta added")).toBeNull();

    dialog = screen.getByRole("dialog", { name: "Diff files" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Change b/ }));

    expect(screen.getByText("beta added")).toBeDefined();
    expect(screen.queryByText("alpha added")).toBeNull();
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
    renderDiff({ files: [file], walkthrough });
    const dialog = openFiles();
    fireEvent.click(within(dialog).getByRole("button", { name: "Steps" }));

    expect(screen.getByText("first hunk")).toBeDefined();
    expect(screen.queryByText("second hunk")).toBeNull();
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
    const dialog = openFiles();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "One at a time" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close files" }));

    const pane = screen.getByText("a added").closest("section")!
      .parentElement as HTMLElement;
    mockPaneGeometry(pane, [400, 300, 200, 60, 40], {
      scrollTop: 500,
      clientHeight: 500,
      scrollHeight: 1000,
    });

    fireEvent.scroll(pane);

    const filesDialog = openFiles();
    await waitFor(() =>
      expect(
        within(filesDialog)
          .getByRole("button", { name: /e\.ts/ })
          .getAttribute("aria-current"),
      ).toBe("location"),
    );
  });
});
