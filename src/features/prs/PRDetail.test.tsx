import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as actualApi from "../../lib/api";
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
    complexity: {
      band: "high",
      score: 88,
      changes: 12,
      sourceFiles: 3,
      deletes: 1,
      rewrites: 4,
      ripples: 2,
    },
  },
);

const getConfig = mock(async () => makeConfig());
const getPR = mock(async () => ({ pr }));
const getPRDiff = mock(async () => diff);
const mergePR = mock(async () => ({ ok: true }));

mock.module("../../lib/api", () => ({
  ...actualApi,
  getConfig,
  getPR,
  getPRDiff,
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
  mergePR.mockClear();
  getConfig.mockImplementation(async () => makeConfig());
  getPR.mockImplementation(async () => ({ pr }));
  getPRDiff.mockImplementation(async () => diff);
});

afterAll(() => {
  mock.module("../../lib/api", () => actualApi);
});

async function renderDetail() {
  const result = renderWithQuery(<PRDetail repo="acme/web" number={42} />);
  await screen.findByText("Add checkout flow");
  return result;
}

describe("PRDetail", () => {
  test("opens on the conversation and shows the context rail", async () => {
    await renderDetail();

    expect(screen.getByRole("tab", { name: /Conversation/ })).toBeDefined();
    expect(screen.getByText("Checkout body copy.")).toBeDefined();
    expect(screen.getByText("Please add tests.")).toBeDefined();

    const rail = screen.getByLabelText("Pull request context");
    expect(within(rail).getByText("Checks passing")).toBeDefined();
    expect(within(rail).getByText("Complexity")).toBeDefined();
    expect(within(rail).getByText("3 source files · 12 changes")).toBeDefined();
  });

  test("hides the context rail on the diff tab and shows the diff", async () => {
    await renderDetail();
    fireEvent.click(screen.getByRole("tab", { name: /^Diff/ }));

    expect(await screen.findByText("added line")).toBeDefined();
    expect(screen.queryByLabelText("Pull request context")).toBeNull();
    expect(getPRDiff).toHaveBeenCalledTimes(1);
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

  test("omits Verdict and Explain tabs when the server offers no actions", async () => {
    await renderDetail();

    expect(screen.queryByRole("tab", { name: /^Verdict/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^Explain/ })).toBeNull();
  });

  test("fades the tab panel when its content overflows", async () => {
    await renderDetail();
    const panel = screen.getByRole("tabpanel");
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(panel, "clientHeight", {
      configurable: true,
      value: 100,
    });

    fireEvent.scroll(panel);

    await waitFor(() => expect(panel.className).toContain("fade-bottom"));
  });

  test("copies the head SHA from the context rail", async () => {
    const writeText = mock(async () => {});
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      await renderDetail();

      fireEvent.click(screen.getByRole("button", { name: "Copy commit SHA" }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(pr.headSHA));
      expect(
        await screen.findByRole("button", { name: "Copied" }),
      ).toBeDefined();
    } finally {
      if (descriptor) {
        Object.defineProperty(navigator, "clipboard", descriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  test("Escape closes the detail", async () => {
    await renderDetail();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(useUIStore.getState().detailOpen).toBe(false);
  });

  test("Escape leaves fullscreen before closing the detail", async () => {
    useUIStore.setState({ detailFullscreen: true });
    await renderDetail();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(useUIStore.getState().detailFullscreen).toBe(false);
    expect(useUIStore.getState().detailOpen).toBe(true);
  });

  test("shows the merged receipt instead of closing the detail", async () => {
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

    mergePR.mockImplementation(async () => {
      merged = true;
      return { ok: true };
    });
    fireEvent.click(screen.getByRole("button", { name: "Squash merge" }));
    const confirm = screen.getByLabelText("Confirm squash merge");
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Squash merge" }),
    );

    await waitFor(() => expect(mergePR).toHaveBeenCalled());
    expect(await screen.findByText(/Merged into/)).toBeDefined();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("9f3c2ab")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Squash merge" })).toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByLabelText("Review comment")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Squash merge" }));
    expect(screen.getByLabelText("Confirm squash merge")).toBeDefined();

    merged = true;
    await act(() =>
      client.invalidateQueries({ queryKey: ["pr", "acme/web", 42] }),
    );

    expect(await screen.findByText(/Merged into/)).toBeDefined();
    expect(screen.queryByLabelText("Review comment")).toBeNull();
    expect(screen.queryByLabelText("Confirm squash merge")).toBeNull();
    expect(screen.queryByRole("button", { name: "Squash merge" })).toBeNull();

    // Nothing hidden is left consuming Escape; it closes the detail.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().detailOpen).toBe(false);
  });

  test("a merged PR opens as its receipt, not the tabbed view", async () => {
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
