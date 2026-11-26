import {
  afterAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import * as actualApi from "../../lib/api";
import { LIVE_BASE_MS } from "../../lib/liveRefresh";
import type { PRListResponse } from "../../lib/types";
import { useUIStore } from "../../stores/ui";
import { makeDiffResponse, makePR } from "../../test/fixtures";
import { createTestQueryClient, renderWithQuery } from "../../test/render";

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
  // The snapshot is taken at module load; an earlier test file in the same
  // process may have left a selection behind.
  useUIStore.setState({ selectedPR: null, detailOpen: false });
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

  test("all open lifts a needs-you row into the hero", async () => {
    const needsYou = makePR({
      number: 7,
      title: "Needs a look",
      author: "octocat",
      reviewRequested: true,
    });
    getPRs.mockImplementation(async () => listResponse([needsYou, middle]));

    renderWithQuery(<PRList tabID="all" tabLabel="All open" repo={null} />);
    await screen.findByRole("listbox");

    const rows = screen.getAllByRole("option");
    expect(rows[0].textContent).toContain("Needs a look");
    expect(rows[0].textContent).toContain("Needs you");
  });

  test("skipping every row restarts the hero cycle", async () => {
    getPRs.mockImplementation(async () => listResponse([middle, newest]));

    renderWithQuery(<PRList tabID="mine" tabLabel="My PRs" repo={null} />);
    await screen.findByRole("listbox");

    const heroTitle = () => screen.getAllByRole("option")[0].textContent;
    expect(heroTitle()).toContain("Newest change");

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(heroTitle()).toContain("Middle change");

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(heroTitle()).toContain("Newest change");
  });

  test("j moves the cursor without opening; Enter opens", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "j" });

    const rows = screen.getAllByRole("option");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(rows[1].id);
    expect(
      rows.every((row) => row.getAttribute("aria-selected") === "false"),
    ).toBe(true);
    expect(useUIStore.getState().selectedPR).toBeNull();

    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(useUIStore.getState().selectedPR).toBe("acme/web#1");
  });

  test("clicking a row opens it without waiting for the cursor", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    fireEvent.click(screen.getAllByRole("option")[1]);

    expect(useUIStore.getState().selectedPR).toBe("acme/web#1");
  });

  test("k stops at the first row instead of wrapping", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "k" });

    const rows = screen.getAllByRole("option");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(rows[0].id);
    expect(useUIStore.getState().selectedPR).toBeNull();

    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(useUIStore.getState().selectedPR).toBe("acme/web#2");
    expect(getPR).not.toHaveBeenCalled();
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

  test("f still opens filters when the search empties the list", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "/" });
    fireEvent.change(screen.getByLabelText("Search pull requests"), {
      target: { value: "no-such-pr" },
    });

    const empty = await screen.findByRole("group", {
      name: "All open pull requests",
    });
    fireEvent.keyDown(empty, { key: "f" });

    expect(
      await screen.findByRole("checkbox", { name: "Hide drafts" }),
    ).toBeDefined();
  });

  test("keys stay inert while a placeholder load is on screen", async () => {
    const client = createTestQueryClient();
    client.setQueryData(["prs", null, "all"], listResponse());
    getPRs.mockImplementation(() => new Promise<PRListResponse>(() => {}));

    const { rerender } = renderWithQuery(
      <PRList tabID="all" tabLabel="All open" repo={null} />,
      { client },
    );
    expect(await screen.findAllByRole("option")).toHaveLength(3);

    // A new tab keeps the old rows in `data` while the skeleton renders.
    rerender(<PRList tabID="mine" tabLabel="My PRs" repo={null} />);
    await screen.findAllByText("Loading…");

    const surface = screen.getByRole("group", {
      name: "My PRs pull requests",
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(surface.getAttribute("aria-activedescendant")).toBeNull();

    act(() => useUIStore.setState({ selectedPR: null }));
    fireEvent.keyDown(surface, { key: "j" });
    expect(useUIStore.getState().selectedPR).toBeNull();
  });

  test("keys stay inert while the list is in an error state", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: Infinity },
      },
    });
    client.setQueryData(["prs", null, "all"], listResponse());
    getPRs.mockImplementation(() => Promise.reject(new Error("boom")));

    renderWithQuery(<PRList tabID="all" tabLabel="All open" repo={null} />, {
      client,
    });
    await screen.findByText(/Can’t load pull requests/);

    const surface = screen.getByRole("group", {
      name: "All open pull requests",
    });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(surface.getAttribute("aria-activedescendant")).toBeNull();

    act(() => useUIStore.setState({ selectedPR: null }));
    fireEvent.keyDown(surface, { key: "j" });
    expect(useUIStore.getState().selectedPR).toBeNull();
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
      expect(useUIStore.getState().selectedPR).toBe("acme/web#2"),
    );
    await waitFor(() =>
      expect(getPR).toHaveBeenCalledWith({
        repo: "acme/web",
        number: 2,
        refresh: true,
      }),
    );
  });

  test("j stops at the last row and Enter opens it once", async () => {
    getPRs.mockImplementation(async () => listResponse());
    const { client } = await renderList();
    // A stale detail under the last row is re-read once, when Enter opens it.
    client.setQueryData(["pr", "acme/web", 3], {
      pr: { ...oldest, headSHA: "oldsha" },
    });

    const listbox = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    fireEvent.keyDown(listbox, { key: "j" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[1].id);
    fireEvent.keyDown(listbox, { key: "j" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[2].id);
    expect(useUIStore.getState().selectedPR).toBeNull();

    fireEvent.keyDown(listbox, { key: "Enter" });
    await waitFor(() =>
      expect(useUIStore.getState().selectedPR).toBe("acme/web#3"),
    );
    await waitFor(() => expect(getPR).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(listbox, { key: "j" });
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[2].id);
  });

  test("Escape clears selection but keeps the cursor", () => {
    getPRs.mockImplementation(async () => listResponse());
    const client = createTestQueryClient();
    client.setQueryData(["prs", null, "all"], listResponse());
    useUIStore.setState({ selectedPR: "acme/web#2", detailOpen: true });
    renderWithQuery(<PRList tabID="all" tabLabel="All open" repo={null} />, {
      client,
    });
    const listbox = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(listbox, { key: "Escape" });

    expect(useUIStore.getState().selectedPR).toBeNull();
    expect(listbox.getAttribute("aria-activedescendant")).toBe(options[0].id);
  });

  test("filters the draft row out from the filter popover", async () => {
    getPRs.mockImplementation(async () => listResponse());
    await renderList();

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "f" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide drafts" }));

    await waitFor(() => expect(screen.queryByText("Oldest draft")).toBeNull());
    expect(useUIStore.getState().prFilters.hideDrafts).toBe(true);
  });

  test("fullscreen stops the list's live refresh", async () => {
    getPRs.mockImplementation(async () => listResponse());
    const originalHasFocus = document.hasFocus.bind(document);
    document.hasFocus = () => true;
    jest.useFakeTimers();
    try {
      // Primed cache so the list mounts now and the live timer arms under the
      // fake clock.
      const client = createTestQueryClient();
      client.setQueryData(["prs", null, "all"], listResponse());
      renderWithQuery(<PRList tabID="all" tabLabel="All open" repo={null} />, {
        client,
      });
      expect(screen.getByRole("listbox")).toBeDefined();

      act(() => {
        jest.advanceTimersByTime(LIVE_BASE_MS);
      });
      expect(getPRs).toHaveBeenCalledTimes(1);

      act(() => {
        useUIStore.setState({ detailFullscreen: true });
      });
      act(() => {
        jest.advanceTimersByTime(LIVE_BASE_MS * 2);
      });
      expect(getPRs).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
      document.hasFocus = originalHasFocus;
    }
  });

  test("shows the repo only when the list spans repositories", async () => {
    getPRs.mockImplementation(async () => listResponse());
    const first = renderWithQuery(
      <PRList tabID="all" tabLabel="All open" repo={null} />,
    );
    const rows = await screen.findAllByRole("option");
    expect(within(rows[0]).getByText("acme/web")).toBeDefined();

    first.unmount();
    renderWithQuery(<PRList tabID="all" tabLabel="All open" repo="acme/web" />);
    const scopedRows = await screen.findAllByRole("option");
    expect(within(scopedRows[0]).queryByText("acme/web")).toBeNull();
  });

  test("an empty response renders the empty state", async () => {
    getPRs.mockImplementation(async () => listResponse([]));
    renderWithQuery(<PRList tabID="all" tabLabel="All open" repo={null} />);

    expect(
      await screen.findByText(/No pull requests in All open/),
    ).toBeDefined();
  });
});
