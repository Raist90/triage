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
  description: "Checkout body copy.",
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
  await screen.findByText("Add checkout flow");
  return result;
}

describe("PRDetail briefing", () => {
  test("opens on the briefing with context, changes and recent conversation", async () => {
    await renderDetail();

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("Checkout body copy.")).toBeDefined();
    expect(screen.getByText("What changed")).toBeDefined();
    expect(screen.getByText("Add the checkout line")).toBeDefined();
    expect(screen.getAllByText("Please add tests.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "All 1 entry" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Start review/ })).toBeDefined();
  });

  test("renders the risk section from a fresh review artifact", async () => {
    getConfig.mockImplementation(async () =>
      makeConfig({ actions: [reviewAction] }),
    );
    getAction.mockImplementation(async () => reviewArtifact);
    await renderDetail();

    expect(await screen.findByText("Where the risk is")).toBeDefined();
    expect(screen.getByText("src/app.ts")).toBeDefined();
    expect(screen.getByText("Risk")).toBeDefined();

    fireEvent.click(screen.getByText("src/app.ts"));

    expect(await screen.findByLabelText("Diff place")).toBeDefined();
    expect(await screen.findByText("added line")).toBeDefined();
  });

  test("the briefing keeps its scroll position across a place", async () => {
    await renderDetail();
    const panel = document.querySelector<HTMLElement>(
      '[data-panel="briefing"]',
    );
    if (!panel) throw new Error("briefing panel missing");
    panel.scrollTop = 240;
    fireEvent.scroll(panel);

    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    await screen.findByLabelText("Diff place");
    fireEvent.click(screen.getByRole("button", { name: "Briefing" }));

    expect(
      document.querySelector<HTMLElement>('[data-panel="briefing"]')?.scrollTop,
    ).toBe(240);
  });
});

describe("PRDetail places", () => {
  test("opens the conversation place and returns to the briefing", async () => {
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: /Conversation/ }));
    expect(screen.getByRole("heading", { name: "Conversation" })).toBeDefined();
    expect(screen.getAllByText("Please add tests.").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Briefing" }));
    expect(
      screen.getByRole("heading", { name: "Add checkout flow" }),
    ).toBeDefined();
  });

  test("the diff place shows the shipped diff", async () => {
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Diff" }));

    expect(screen.getByLabelText("Diff place")).toBeDefined();
    expect(await screen.findByText("added line")).toBeDefined();
    expect(getPRDiff).toHaveBeenCalledTimes(1);
  });

  test("Start review opens the Review place", async () => {
    getConfig.mockImplementation(async () =>
      makeConfig({ actions: [reviewAction] }),
    );
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: /Start review/ }));

    expect(screen.getByRole("heading", { name: "Review" })).toBeDefined();
    expect(await screen.findByText("Review this pull request")).toBeDefined();
  });

  test("Explain is a place with its empty state, absent when unconfigured", async () => {
    await renderDetail();
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();

    getConfig.mockImplementation(async () =>
      makeConfig({ actions: [explainAction] }),
    );
    await renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));

    expect(screen.getByRole("heading", { name: "Explain" })).toBeDefined();
    expect(
      await screen.findByText("No explain artifact for this head"),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Explain this PR" }),
    ).toBeDefined();
  });

  test("Escape returns a place to the briefing before fullscreen and close", async () => {
    useUIStore.setState({ detailFullscreen: true });
    await renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    expect(screen.getByLabelText("Diff place")).toBeDefined();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().detailFullscreen).toBe(true);
    expect(screen.queryByLabelText("Diff place")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().detailFullscreen).toBe(false);
    expect(useUIStore.getState().detailOpen).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().detailOpen).toBe(false);
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
    await screen.findByText("Add checkout flow");

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
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start review/ })).toBeNull();
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

describe("PRDetail receipts and errors", () => {
  test("a merged PR opens as its receipt, not the briefing", async () => {
    getPR.mockImplementation(async () => ({
      pr: makePR({
        state: "merged",
        mergedAt: "2026-06-15T12:00:00Z",
        mergedBy: "octocat",
        mergeCommitSHA: "9f3c2abffee12",
      }),
    }));
    await renderDetail();

    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByLabelText("Pull request context")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start review/ })).toBeNull();
    expect(screen.getByText(/Merged into/)).toBeDefined();
    expect(screen.getByText("Merge commit")).toBeDefined();
    expect(getPRDiff).not.toHaveBeenCalled();
  });

  test("a closed PR keeps the receipt but drops the merge rows", async () => {
    getPR.mockImplementation(async () => ({
      pr: makePR({ state: "closed", isDraft: false }),
    }));
    await renderDetail();

    expect(screen.getByText("Closed without merging")).toBeDefined();
    expect(screen.queryByText("Merge commit")).toBeNull();
    expect(screen.queryByText("Merged")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
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
      expect(screen.getByText("Add checkout flow")).toBeDefined(),
    );
  });
});
