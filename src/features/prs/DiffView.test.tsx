import { beforeEach, describe, expect, test } from "bun:test";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useUIStore } from "../../stores/ui";
import {
  makeCommentsController,
  makeFile,
  makeHunk,
  makeLine,
} from "../../test/fixtures";
import type { DiffCommentsController } from "./useDiffComments";
import { DiffView } from "./DiffView";

const initialUIState = useUIStore.getState();

beforeEach(() => {
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

function renderDiff(
  overrides: {
    files?: ReturnType<typeof makeFile>[];
    canComment?: boolean;
    focusTarget?: { path: string; line?: number; token: number };
    comments?: DiffCommentsController;
    semantic?: boolean;
  } = {},
) {
  const files = overrides.files ?? [fileA(), fileB()];
  return render(
    <DiffView
      files={files}
      semanticAvailable={overrides.semantic ?? false}
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
});
