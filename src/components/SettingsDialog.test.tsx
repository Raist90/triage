import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import * as actualApi from "../lib/api";
import { makeConfig } from "../test/fixtures";
import { renderWithQuery } from "../test/render";

const invalidateCache = mock(async () => ({ cleared: 2 }));
const clearArtifacts = mock(async () => ({ cleared: 3 }));
const clearWorktrees = mock(async () => ({ cleared: 1 }));

mock.module("../lib/api", () => ({
  ...actualApi,
  invalidateCache,
  clearArtifacts,
  clearWorktrees,
}));

const { SettingsDialog } = await import("./SettingsDialog");

beforeEach(() => {
  invalidateCache.mockClear();
  clearArtifacts.mockClear();
  clearWorktrees.mockClear();
  invalidateCache.mockImplementation(async () => ({ cleared: 2 }));
  clearArtifacts.mockImplementation(async () => ({ cleared: 3 }));
  clearWorktrees.mockImplementation(async () => ({ cleared: 1 }));
});

afterAll(() => {
  mock.module("../lib/api", () => actualApi);
});

function renderDialog(onClose = () => {}) {
  return renderWithQuery(
    <SettingsDialog open config={makeConfig()} onClose={onClose} />,
  );
}

describe("SettingsDialog", () => {
  test("refreshing data reports the number of cleared responses", async () => {
    const { client } = renderDialog();
    const invalidate = mock(client.invalidateQueries.bind(client));
    client.invalidateQueries = invalidate;
    fireEvent.click(screen.getByRole("button", { name: /Refresh data/ }));

    expect(
      await screen.findByText("Cleared 2 cached responses."),
    ).toBeDefined();
    expect(invalidateCache).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith();
  });

  test("clearing artifacts invalidates cached action queries", async () => {
    const { client } = renderDialog();
    const invalidate = mock(client.invalidateQueries.bind(client));
    client.invalidateQueries = invalidate;

    fireEvent.click(screen.getByRole("button", { name: /Clear artifacts/ }));

    expect(await screen.findByText("Cleared 3 artifacts.")).toBeDefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pr-action"] });
  });

  test("a failed command surfaces the server message", async () => {
    clearWorktrees.mockImplementation(async () => {
      throw new Error("worktree directory is busy");
    });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Clear worktrees/ }));

    expect(await screen.findByText("worktree directory is busy")).toBeDefined();
    expect(screen.queryByText(/Cleared/)).toBeNull();
  });

  test("Escape closes the dialog", () => {
    let closed = false;
    renderDialog(() => {
      closed = true;
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(closed).toBe(true);
  });

  test("clicking the backdrop closes but clicking the panel does not", () => {
    let closed = 0;
    renderDialog(() => {
      closed += 1;
    });
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);
    expect(closed).toBe(0);

    fireEvent.mouseDown(dialog.parentElement ?? dialog);
    expect(closed).toBe(1);
  });

  test("summarizes review availability and names blocked repos", () => {
    const config = makeConfig({
      repos: [
        {
          owner: "acme",
          name: "web",
          actions: true,
          review: { available: true },
        },
        {
          owner: "acme",
          name: "api",
          actions: false,
          review: {
            available: false,
            reason: "No local path configured",
          },
        },
      ],
    });
    renderWithQuery(<SettingsDialog open config={config} onClose={() => {}} />);

    expect(screen.getByText("/Users/test/.triage/config.json")).toBeDefined();
    expect(
      screen.getByText("Review is available in 1 of 2 repositories."),
    ).toBeDefined();
    expect(screen.getByText("No local path configured")).toBeDefined();
    expect(screen.queryByText("Review ready")).toBeNull();
  });

  test("renders nothing while closed", () => {
    renderWithQuery(
      <SettingsDialog open={false} config={makeConfig()} onClose={() => {}} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
