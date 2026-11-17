import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import * as actualApi from "../../lib/api";
import type { PRListResponse } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { makeDiffResponse, makePR } from "../../test/fixtures";
import { renderWithQuery } from "../../test/render";

const getPRs = mock(async (): Promise<PRListResponse> => ({
  prs: [],
  viewer: { login: "viewer", name: "Viewer" },
}));

const getPR = mock(async () => ({ pr: makePR() }));
const getPRDiff = mock(async () => makeDiffResponse([]));

mock.module("../../lib/api", () => ({
  ...actualApi,
  getPRs,
  getPR,
  getPRDiff,
}));

const { PRList } = await import("./PRList");

const initialUIState = useUIStore.getState();

beforeEach(() => {
  useUIStore.setState(initialUIState, true);
  getPRs.mockClear();
  getPR.mockClear();
  getPRDiff.mockClear();
  getPR.mockImplementation(async () => ({ pr: makePR() }));
  getPRDiff.mockImplementation(async () => makeDiffResponse([]));
});

afterAll(() => {
  mock.module("../../lib/api", () => actualApi);
});

const newest = makePR({
  number: 2,
  title: "Newest change",
  updatedAt: "2026-06-15T11:00:00Z",
});
const middle = makePR({
  number: 1,
  title: "Middle change",
  updatedAt: "2026-06-15T10:00:00Z",
});
const oldest = makePR({
  number: 3,
  title: "Oldest draft",
  isDraft: true,
  updatedAt: "2026-06-15T09:00:00Z",
});

function listResponse(prs = [middle, newest, oldest]): PRListResponse {
  return { prs, viewer: { login: "viewer", name: "Viewer" } };
}

async function renderList() {
  const result = renderWithQuery(
    <PRList tabID="all" tabLabel="All open" repo={null} />,
  );
  await screen.findByRole("listbox");
  return result;
}

describe("PRList", () => {
  test("shows pull requests newest first", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    const rows = screen.getAllByRole("option");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Newest change"),
      expect.stringContaining("Middle change"),
      expect.stringContaining("Oldest draft"),
    ]);
    expect(getPRs).toHaveBeenCalledWith({
      tab: "all",
      repo: null,
      refresh: false,
    });
  });

  test("j moves the cursor and Enter opens that pull request", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "j" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(useUIStore.getState().selectedPR).toBe("acme/web#1");
  });

  test("k stops at the first row instead of wrapping", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "k" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(useUIStore.getState().selectedPR).toBe("acme/web#2");
  });

  test("/ opens search and narrows the list without a new request", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();
    const callCount = getPRs.mock.calls.length;

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "/" });
    const search = screen.getByLabelText("Search pull requests");
    fireEvent.change(search, { target: { value: "middle" } });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getByText("Middle change")).toBeDefined();
    expect(getPRs.mock.calls.length).toBe(callCount);
  });

  test("refresh bypasses the cache and replaces the rows", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    getPRs.mockImplementation(async () =>
      listResponse([makePR({ number: 9, title: "Fresh from GitHub" })]),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh from GitHub" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Fresh from GitHub")).toBeDefined(),
    );
    expect(getPRs).toHaveBeenLastCalledWith({
      tab: "all",
      repo: null,
      refresh: true,
    });
  });

  test("refresh re-reads the open pull request and its diff", async () => {
    getPRs.mockImplementation(async () => listResponse());
    useUIStore.setState({ selectedPR: "acme/web#2", detailOpen: true });
    const { client } = await renderList();

    const moved = { ...newest, headSHA: "def9999" };
    getPR.mockImplementation(async () => ({ pr: moved }));
    getPRDiff.mockImplementation(async () =>
      makeDiffResponse([], { headSHA: moved.headSHA }),
    );
    getPRs.mockImplementation(async () =>
      listResponse([moved, middle, oldest]),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Refresh from GitHub" }),
    );

    await waitFor(() =>
      expect(getPR).toHaveBeenLastCalledWith({
        repo: "acme/web",
        number: 2,
        refresh: true,
      }),
    );
    await waitFor(() =>
      expect(getPRDiff).toHaveBeenLastCalledWith({
        repo: "acme/web",
        number: 2,
        refresh: true,
      }),
    );
    expect(
      client.getQueryData(["pr-diff", "acme/web", 2, "def9999"]),
    ).toBeDefined();
  });

  test("opening a pull request re-reads a detail from an older head", async () => {
    getPRs.mockImplementation(async () => listResponse());
    getPR.mockImplementation(async () => ({ pr: newest }));
    const { client } = await renderList();
    client.setQueryData(["pr", "acme/web", 2], {
      pr: { ...newest, headSHA: "oldsha" },
    });

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });

    await waitFor(() =>
      expect(getPR).toHaveBeenCalledWith({
        repo: "acme/web",
        number: 2,
        refresh: true,
      }),
    );
  });

  test("filters the draft row out from the filter popover", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "f" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide drafts" }));

    await waitFor(() => expect(screen.queryByText("Oldest draft")).toBeNull());
    expect(useUIStore.getState().prFilters.hideDrafts).toBe(true);
  });

  test("an empty response renders the empty state", async () => {
    getPRs.mockImplementation(async () => listResponse([]));
    renderWithQuery(<PRList tabID="all" tabLabel="All open" repo={null} />);

    expect(
      await screen.findByText(/No pull requests in All open/),
    ).toBeDefined();
  });
});
