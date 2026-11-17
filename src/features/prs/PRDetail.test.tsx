import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

mock.module("../../lib/api", () => ({
  ...actualApi,
  getConfig,
  getPR,
  getPRDiff,
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

  test("omits Review and Explain tabs when the server offers no actions", async () => {
    await renderDetail();

    expect(screen.queryByRole("tab", { name: /^Review/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^Explain/ })).toBeNull();
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
