import { describe, expect, test } from "bun:test";
import { makePR } from "../../test/fixtures";
import {
  bucketFor,
  buildDeck,
  deckOrder,
  isDim,
  reasonFor,
  severityFor,
} from "./deck";

const viewer = "viewer";

function pr(number: number, overrides = {}) {
  return makePR({
    number,
    author: "viewer",
    repo: "acme/web",
    updatedAt: `2026-06-15T0${number}:00:00Z`,
    ...overrides,
  });
}

describe("bucketFor", () => {
  test("drafts override every other assignment in every tab", () => {
    const draft = pr(1, {
      isDraft: true,
      reviewState: "changes_requested",
      checkStatus: "failure",
      reviewRequested: true,
    });
    expect(bucketFor(draft, "mine", viewer)).toBe("drafts");
    expect(bucketFor(draft, "review", viewer)).toBe("drafts");
    expect(bucketFor(draft, "all", viewer)).toBe("drafts");
  });

  test("mine splits blocked, ready and waiting", () => {
    expect(
      bucketFor(pr(1, { reviewState: "changes_requested" }), "mine", viewer),
    ).toBe("blocked");
    expect(bucketFor(pr(1, { checkStatus: "failure" }), "mine", viewer)).toBe(
      "blocked",
    );
    expect(
      bucketFor(
        pr(1, { reviewState: "approved", checkStatus: "success" }),
        "mine",
        viewer,
      ),
    ).toBe("ready");
    expect(
      bucketFor(
        pr(1, { reviewState: "review_required", checkStatus: "pending" }),
        "mine",
        viewer,
      ),
    ).toBe("waiting");
  });

  test("all distinguishes needs, yours and waiting", () => {
    expect(bucketFor(pr(1, { reviewRequested: true }), "all", viewer)).toBe(
      "needs",
    );
    expect(
      bucketFor(pr(1, { reviewState: "changes_requested" }), "all", viewer),
    ).toBe("needs");
    expect(bucketFor(pr(1), "all", viewer)).toBe("yours");
    expect(bucketFor(pr(1, { author: "someone" }), "all", viewer)).toBe(
      "waiting",
    );
  });

  test("compares logins case-insensitively", () => {
    expect(bucketFor(pr(1, { author: "Viewer" }), "all", viewer)).toBe("yours");
  });
});

describe("severityFor / reasonFor / isDim", () => {
  test("severity follows blocking, warn, wait", () => {
    expect(severityFor(pr(1, { checkStatus: "failure" }))).toBe("blocked");
    expect(severityFor(pr(1, { checkStatus: "pending" }))).toBe("warn");
    expect(severityFor(pr(1, { reviewState: "approved" }))).toBe("wait");
  });

  test("reason is the first matching string", () => {
    expect(
      reasonFor(
        pr(1, {
          reviewState: "changes_requested",
          checkStatus: "failure",
          reviewRequested: true,
        }),
      ),
    ).toBe("changes requested");
    expect(reasonFor(pr(1, { reviewRequested: true }))).toBe(
      "review requested",
    );
    expect(reasonFor(pr(1, { viewerReview: "approved" }))).toBe("you approved");
    expect(reasonFor(pr(1))).toBe("review required");
  });

  test("only waiting buckets dim, and drafts never do", () => {
    expect(isDim(pr(1), "mine", "waiting")).toBe(true);
    expect(isDim(pr(1), "all", "waiting")).toBe(true);
    expect(isDim(pr(1), "mine", "blocked")).toBe(false);
    expect(isDim(pr(1, { isDraft: true }), "mine", "waiting")).toBe(false);
  });
});

describe("deckOrder", () => {
  test("orders by bucket, severity, recency, repo, number", () => {
    const blocked = pr(1, {
      author: "someone",
      reviewState: "changes_requested",
    });
    const warn = pr(2, { author: "someone", checkStatus: "pending" });
    const wait = pr(3, { author: "someone", reviewState: "approved" });
    const ordered = deckOrder([wait, warn, blocked], "all", viewer);
    expect(ordered.map((item) => item.number)).toEqual([1, 2, 3]);
  });

  test("drafts use recency only", () => {
    const older = pr(1, { isDraft: true, updatedAt: "2026-06-15T08:00:00Z" });
    const newer = pr(2, { isDraft: true, updatedAt: "2026-06-15T09:00:00Z" });
    expect(
      deckOrder([older, newer], "mine", viewer).map((item) => item.number),
    ).toEqual([2, 1]);
  });
});

describe("buildDeck", () => {
  test("groups rows into buckets and flattens them in visual order", () => {
    const ready = pr(2, { reviewState: "approved", checkStatus: "success" });
    const blocked = pr(3, { reviewState: "changes_requested" });
    const draft = pr(1, { isDraft: true });
    const deck = buildDeck([ready, blocked, draft], "mine", viewer);

    expect(deck.buckets.map((bucket) => bucket.id)).toEqual([
      "blocked",
      "ready",
      "drafts",
    ]);
    expect(deck.buckets[0].rows).toEqual([blocked]);
    expect(deck.buckets[1].rows).toEqual([ready]);
    expect(deck.rows.map((row) => row.pr.number)).toEqual([3, 2, 1]);
    expect(deck.rows.map((row) => row.bucket)).toEqual([
      "blocked",
      "ready",
      "drafts",
    ]);
  });

  test("the first row stays in its bucket and empty buckets are omitted", () => {
    const needs = pr(1, { author: "someone", reviewRequested: true });
    const waiting = pr(2, { author: "someone" });
    const deck = buildDeck([waiting, needs], "all", viewer);

    expect(deck.buckets.map((bucket) => bucket.id)).toEqual([
      "needs",
      "waiting",
    ]);
    expect(deck.buckets[0].rows).toEqual([needs]);
    expect(deck.rows[0]).toEqual({ pr: needs, bucket: "needs" });
  });
});
