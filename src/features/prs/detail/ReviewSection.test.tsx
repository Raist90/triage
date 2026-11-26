import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  ActionArtifact,
  ReviewDocument,
  ReviewFinding,
} from "../../../lib/types";
import { makePR } from "../../../test/fixtures";
import type { ClaudeActionController } from "../action/useClaudeAction";
import { ReviewSection } from "./ReviewSection";

const artifact: ActionArtifact = {
  action: "review",
  createdAt: "2026-06-15T12:00:00Z",
  markdown: "",
  model: "haiku",
  promptVersion: "1",
  sha: "abc1234def5678",
  usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0.1 },
};

const finding: ReviewFinding = {
  id: "finding-1",
  anchored: true,
  category: "risk",
  claim: "The early return skips commit.",
  file: "src/app.ts",
  line: 2,
  severity: "blocking",
  title: "Skipped commit",
};

const review: ReviewDocument = {
  findings: [finding],
  verdict: { safeToMerge: false, summary: "One blocking finding." },
};

function controller(
  overrides: Partial<ClaudeActionController> = {},
): ClaudeActionController {
  const base: ClaudeActionController = {
    kind: "review",
    enabled: true,
    action: { id: "review-1", kind: "review", label: "Review" },
    job: undefined,
    phase: "done",
    artifact: undefined,
    review: undefined,
    worktree: undefined,
    stale: false,
    running: false,
    liveText: "",
    error: null,
    run: () => {},
    cancel: () => {},
  };
  return { ...base, ...overrides };
}

function renderSection(
  overrides: Partial<ClaudeActionController> = {},
  options: {
    unavailable?: boolean;
    onFocusFinding?: (finding: ReviewFinding) => void;
  } = {},
) {
  return render(
    <ReviewSection
      pr={makePR({ reviewState: "changes_requested" })}
      controller={controller(overrides)}
      reviewAvailable={!options.unavailable}
      unavailableReason={options.unavailable ? "No local clone." : undefined}
      configPath="/Users/test/.triage/config.json"
      onFocusFinding={options.onFocusFinding ?? (() => {})}
    />,
  );
}

describe("ReviewSection", () => {
  test("shows GitHub review state and the artifact meta", () => {
    renderSection({ artifact, review });
    expect(screen.getByText("Changes requested")).toBeDefined();
    expect(screen.getByText(/haiku/)).toBeDefined();
  });

  test("renders the verdict, counts and one index row per finding", () => {
    renderSection({ artifact, review });
    expect(screen.getByText("Needs work")).toBeDefined();
    expect(screen.getByText(/1 blocking/)).toBeDefined();
    expect(screen.getByText("src/app.ts:2")).toBeDefined();
    expect(screen.getByText("Skipped commit")).toBeDefined();
  });

  test("clicking an index row asks the diff to focus that finding", () => {
    const onFocusFinding = mock(() => {});
    renderSection({ artifact, review }, { onFocusFinding });

    fireEvent.click(screen.getByText("src/app.ts:2"));

    expect(onFocusFinding).toHaveBeenCalledWith(finding);
  });

  test("running review shows the live stages", () => {
    renderSection({ running: true, phase: "running" });
    expect(screen.getByText("Automatic review")).toBeDefined();
  });

  test("a stale artifact says so and hides the index", () => {
    renderSection({ artifact, review, stale: true });
    expect(screen.getByText(/older commit/)).toBeDefined();
    expect(screen.queryByText("Skipped commit")).toBeNull();
  });

  test("an unavailable review explains repoPaths", () => {
    renderSection({}, { unavailable: true });
    expect(
      screen.getByText(/Automatic review needs a local clone/),
    ).toBeDefined();
    expect(screen.getByText(/No local clone/)).toBeDefined();
  });

  test("a failed review keeps its message visible", () => {
    renderSection({ error: "Claude exited with code 1" });
    expect(screen.getByRole("alert").textContent).toContain(
      "Claude exited with code 1",
    );
  });

  test("a fresh head with no artifact invites a run", () => {
    renderSection({});
    expect(screen.getByText(/No automatic review on/)).toBeDefined();
  });
});
