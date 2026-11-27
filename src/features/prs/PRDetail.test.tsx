import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as actualApi from "../../lib/api";
import type { ActionResponse } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import {
  makeConfig,
  makeDiffResponse,
  makeFile,
  makeHunk,
  makeLine,
  makePR,
} from "../../test/fixtures";
import { renderWithQuery } from "../../test/render";

const pr = makePR({
  title: "Add checkout flow",
  description: "Checkout body copy.\n\nSecond paragraph.",
  comments: [
    {
      author: "octocat",
      body: "Please add tests.",
      createdAt: "2026-06-15T11:00:00Z",
      kind: "comment",
    },
  ],
});

const diff = makeDiffResponse(
  [
    makeFile({
      path: "src/app.ts",
      hunks: [
        makeHunk({
          header: "@@ -1,2 +1,2 @@",
          lines: [
            makeLine({
              kind: "context",
              oldNumber: 1,
              newNumber: 1,
              text: "context",
            }),
            makeLine({ kind: "add", newNumber: 2, text: "added line" }),
          ],
        }),
      ],
    }),
  ],
  {
    walkthrough: {
      steps: [
        {
          id: "step-1",
          title: "Add the checkout line",
          additions: 1,
          deletions: 0,
          files: [{ path: "src/app.ts", hunks: [0] }],
        },
      ],
    },
  },
);

const reviewAction = {
  id: "review-1",
  kind: "review" as const,
  label: "Review",
};
const explainAction = {
  id: "explain-1",
  kind: "explain" as const,
  label: "Explain",
};

const reviewArtifact: ActionResponse = {
  artifact: {
    action: "review",
    createdAt: "2026-06-15T12:00:00Z",
    markdown: "",
    model: "haiku",
    promptVersion: "1",
    sha: pr.headSHA,
    usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0.1 },
    review: {
      findings: [
        {
          id: "finding-1",
          anchored: true,
          category: "risk",
          claim: "The early return skips commit.",
          file: "src/app.ts",
          line: 2,
          severity: "blocking",
          suggestion: "Commit before returning.",
          title: "Skipped commit",
        },
      ],
      verdict: { safeToMerge: false, summary: "One blocking finding." },
    },
  },
};

const getConfig = mock(async () => makeConfig());
const getPR = mock(async () => ({ pr }));
const getPRDiff = mock(async () => diff);
const getAction = mock(async (): Promise<ActionResponse | null> => null);
const mergePR = mock(async () => ({ ok: true }));

mock.module("../../lib/api", () => ({
  ...actualApi,
  getConfig,
  getPR,
  getPRDiff,
  getAction,
  mergePR,
}));

// `mock.module` must run before the component module is evaluated, and static
// imports hoist above it; this test intentionally exercises that boundary.
const { PRDetail } = await import("./PRDetail");

const initialUIState = useUIStore.getState();

beforeEach(() => {
  useUIStore.setState(
    {
      ...initialUIState,
      selectedPR: "acme/web#42",
      detailOpen: true,
    },
    true,
  );
  getConfig.mockClear();
  getPR.mockClear();
  getPRDiff.mockClear();
  getAction.mockClear();
  mergePR.mockClear();
  getConfig.mockImplementation(async () => makeConfig());
  getPR.mockImplementation(async () => ({ pr }));
  getPRDiff.mockImplementation(async () => diff);
  getAction.mockImplementation(async () => null);
});

afterAll(() => {
  mock.module("../../lib/api", () => actualApi);
});

async function renderDetail() {
  const result = renderWithQuery(<PRDetail repo="acme/web" number={42} />);
  await screen.findByRole("button", { name: /Context/ });
  return result;
}

describe("PRDetail document", () => {
  test("is one screen: bar, Context, strip, diff, and no repeated title", async () => {
    await renderDetail();

    expect(screen.queryByText("Add checkout flow")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.getAllByText("acme/web", { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Context/ })).toBeDefined();
    expect(screen.getByText("2 files")).toBeDefined();
    expect(await screen.findByText("added line")).toBeDefined();
    expect(screen.getByRole("button", { name: "Start review" })).toBeDefined();
  });

  test("Context starts collapsed, expands in place and closes first on Escape", async () => {
    useUIStore.setState({ detailFullscreen: true });
    await renderDetail();
    const context = screen.getByRole("button", { name: /Context/ });
    expect(context.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(context);
    expect(context.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(context.getAttribute("aria-expanded")).toBe("false");
    expect(useUIStore.getState().detailFullscreen).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().detailFullscreen).toBe(false);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().detailOpen).toBe(false);
  });

  test("a finding index row jumps into the diff", async () => {
    getConfig.mockImplementation(async () =>
      makeConfig({ actions: [reviewAction] }),
    );
    getAction.mockImplementation(async () => reviewArtifact);
    await renderDetail();

    const index = await screen.findByText("src/app.ts:2");
    expect(index).toBeDefined();
    fireEvent.click(index);
    expect(await screen.findByText("added line")).toBeDefined();
  });

  test("findings render as threads on their line as well as in the bar", async () => {
    getConfig.mockImplementation(async () =>
      makeConfig({ actions: [reviewAction] }),
    );
    getAction.mockImplementation(async () => reviewArtifact);
    await renderDetail();

    await waitFor(() =>
      expect(
        screen.getAllByText("Skipped commit").length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(screen.getByText("The early return skips commit.")).toBeDefined();
  });

  test("a stale artifact says so and does not anchor findings", async () => {
    getConfig.mockImplementation(async () =>
      makeConfig({ actions: [reviewAction] }),
    );
    getAction.mockImplementation(async () => ({
      artifact: {
        ...reviewArtifact.artifact!,
        sha: "0000000000000",
      },
    }));
    await renderDetail();

    expect(
      await screen.findByText(/This review is from an older commit/),
    ).toBeDefined();
    expect(screen.queryByText("Skipped commit")).toBeNull();
  });

  test("review submission mounts at the top of the bar and Escape closes it first", async () => {
    await renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Request changes/ }));

    expect(screen.getByLabelText("Review comment")).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("Review comment")).toBeNull();
    expect(useUIStore.getState().detailOpen).toBe(true);
  });

  test("unavailable review explains repoPaths and disables the action", async () => {
    getConfig.mockImplementation(async () =>
      makeConfig({
        actions: [reviewAction],
        repos: [
          {
            owner: "acme",
            name: "web",
            actions: true,
            review: { available: false, reason: "No local clone." },
          },
        ],
      }),
    );
    await renderDetail();

    expect(
      await screen.findByText(/Automatic review needs a local clone/),
    ).toBeDefined();
    expect(screen.getByText(/No local clone/)).toBeDefined();
    const start = screen.getByRole("button", { name: "Start review" });
    expect(start.hasAttribute("disabled")).toBe(true);
  });

  test("explain is in the bar when configured", async () => {
    getConfig.mockImplementation(async () =>
      makeConfig({ actions: [explainAction] }),
    );
    await renderDetail();

    expect(
      await screen.findByRole("button", { name: "Explain this PR" }),
    ).toBeDefined();
  });
});

describe("PRDetail receipts and errors", () => {
  test("a merged PR opens as its receipt and never loads a diff", async () => {
    getPR.mockImplementation(async () => ({
      pr: makePR({
        state: "merged",
        mergedAt: "2026-06-15T12:00:00Z",
        mergedBy: "octocat",
        mergeCommitSHA: "9f3c2abffee12",
      }),
    }));
    renderWithQuery(<PRDetail repo="acme/web" number={42} />);

    expect(await screen.findByText(/Merged into/)).toBeDefined();
    expect(screen.getByText("Merge commit")).toBeDefined();
    expect(screen.queryByLabelText("Review bar")).toBeNull();
    expect(getPRDiff).not.toHaveBeenCalled();
  });

  test("a closed PR keeps the receipt but drops the merge rows", async () => {
    getPR.mockImplementation(async () => ({
      pr: makePR({ state: "closed", isDraft: false }),
    }));
    renderWithQuery(<PRDetail repo="acme/web" number={42} />);

    expect(await screen.findByText("Closed without merging")).toBeDefined();
    expect(screen.queryByText("Merge commit")).toBeNull();
    expect(screen.queryByLabelText("Review bar")).toBeNull();
  });

  test("a failed PR load offers a retry", async () => {
    getPR.mockImplementation(async () => {
      throw new Error("GitHub is unavailable");
    });
    renderWithQuery(<PRDetail repo="acme/web" number={42} />);

    expect(
      await screen.findByText("Can’t load this pull request"),
    ).toBeDefined();
    expect(screen.getByText("GitHub is unavailable")).toBeDefined();

    getPR.mockImplementation(async () => ({ pr }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Context/ })).toBeDefined(),
    );
  });

  test("never caches a diff under a head it does not describe", async () => {
    const movedSHA = "fedcba9876543";
    const movedPR = { ...pr, headSHA: movedSHA };
    const movedDiff = makeDiffResponse([makeFile({ path: "src/moved.ts" })], {
      headSHA: movedSHA,
    });
    let detailCalls = 0;
    getPR.mockImplementation(async () => {
      detailCalls += 1;
      return { pr: detailCalls === 1 ? pr : movedPR };
    });
    getPRDiff.mockImplementation(async () => movedDiff);

    const { client } = renderWithQuery(
      <PRDetail repo="acme/web" number={42} />,
    );
    await screen.findByRole("button", { name: /Context/ });

    await waitFor(() =>
      expect(
        client.getQueryData(["pr-diff", "acme/web", 42, movedSHA]),
      ).toBeDefined(),
    );
    expect(
      client.getQueryData(["pr-diff", "acme/web", 42, pr.headSHA]),
    ).toBeUndefined();
    expect(detailCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("PRDetail Manage", () => {
  test("squash merge runs from Manage and lands on the receipt", async () => {
    const myPR = makePR({
      author: "viewer",
      viewerLogin: "viewer",
      mergeable: "mergeable",
      mergeStateStatus: "clean",
    });
    const mergedPR = makePR({
      ...myPR,
      state: "merged",
      mergedAt: "2026-06-15T12:00:00Z",
      mergedBy: "viewer",
      mergeCommitSHA: "9f3c2abffee12",
    });
    let merged = false;
    getPR.mockImplementation(async () => ({ pr: merged ? mergedPR : myPR }));
    useUIStore.setState({ detailFullscreen: true });
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Squash merge" }));
    const confirm = screen.getByLabelText("Confirm squash merge");
    mergePR.mockImplementation(async () => {
      merged = true;
      return { ok: true };
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Squash merge" }),
    );

    await waitFor(() => expect(mergePR).toHaveBeenCalled());
    expect(await screen.findByText(/Merged into/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
    expect(screen.getByText("9f3c2ab")).toBeDefined();
    expect(useUIStore.getState().selectedPR).toBe("acme/web#42");
    expect(useUIStore.getState().detailOpen).toBe(true);
  });

  test("drops open review and confirmation controls when the PR is merged", async () => {
    const myPR = makePR({
      author: "viewer",
      viewerLogin: "viewer",
      mergeable: "mergeable",
      mergeStateStatus: "clean",
    });
    const mergedPR = makePR({
      ...myPR,
      state: "merged",
      mergedAt: "2026-06-15T12:00:00Z",
      mergedBy: "viewer",
      mergeCommitSHA: "9f3c2abffee12",
    });
    let merged = false;
    getPR.mockImplementation(async () => ({ pr: merged ? mergedPR : myPR }));
    const { client } = await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Request changes/ }));
    expect(screen.getByLabelText("Review comment")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Close pull request" }),
    );
    expect(screen.getByLabelText("Confirm close pull request")).toBeDefined();

    merged = true;
    await act(() =>
      client.invalidateQueries({ queryKey: ["pr", "acme/web", 42] }),
    );

    expect(await screen.findByText(/Merged into/)).toBeDefined();
    expect(screen.queryByLabelText("Review comment")).toBeNull();
    expect(screen.queryByLabelText("Confirm close pull request")).toBeNull();

    // Nothing hidden is left consuming Escape; it closes the detail.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().detailOpen).toBe(false);
  });
});
