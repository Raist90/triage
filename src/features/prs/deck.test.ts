import { describe, expect, test } from "bun:test";
import { makePR } from "../../test/fixtures";
import {
  bucketFor,
  buildDeck,
  canBeHero,
  deckOrder,
  isDim,
  prKey,
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
  test("mine lifts the first eligible ready row out of its bucket", () => {
    const ready = pr(2, { reviewState: "approved", checkStatus: "success" });
    const blocked = pr(3, { reviewState: "changes_requested" });
    const draft = pr(1, { isDraft: true });
    const deck = buildDeck([ready, blocked, draft], "mine", viewer);

    expect(deck.hero && prKey(deck.hero)).toBe(prKey(blocked));
    expect(deck.heroKind).toBe("ready");
    expect(deck.buckets.map((bucket) => bucket.id)).toEqual([
      "ready",
      "drafts",
    ]);
    expect(deck.buckets[0].rows).toEqual([ready]);
    expect(deck.buckets[1].rows).toEqual([draft]);
    expect(deck.rows[0].pr).toBe(blocked);
    expect(deck.rows[0].bucket).toBeNull();
  });

  test("hero is not repeated and bucket counts exclude it", () => {
    const first = pr(2, {
      reviewState: "changes_requested",
      updatedAt: "2026-06-15T09:00:00Z",
    });
    const second = pr(3, { reviewState: "changes_requested" });
    const deck = buildDeck([first, second], "mine", viewer);

    expect(deck.hero).toBe(first);
    expect(deck.buckets[0].id).toBe("blocked");
    expect(deck.buckets[0].rows).toEqual([second]);
  });

  test("skip re-elects without removing the row", () => {
    const first = pr(2, {
      reviewState: "changes_requested",
      updatedAt: "2026-06-15T09:00:00Z",
    });
    const second = pr(3, { reviewState: "changes_requested" });
    const skipped = new Set([prKey(first)]);
    const deck = buildDeck([first, second], "mine", viewer, skipped);

    expect(deck.hero).toBe(second);
    expect(deck.buckets[0].rows).toEqual([first]);
  });

  test("falls back to the first non-skipped draft", () => {
    const ready = pr(2, { reviewState: "approved", checkStatus: "success" });
    const draft = pr(1, { isDraft: true });
    const deck = buildDeck(
      [ready, draft],
      "mine",
      viewer,
      new Set([prKey(ready)]),
    );

    expect(deck.hero).toBe(draft);
    expect(deck.heroKind).toBe("draft");
    expect(deck.buckets[0].id).toBe("ready");
  });

  test("no eligible row means no hero and no placeholder", () => {
    const draft = pr(1, { isDraft: true });
    const deck = buildDeck([draft], "mine", viewer, new Set([prKey(draft)]));
    expect(deck.hero).toBeNull();
    expect(deck.buckets[0].rows).toEqual([draft]);
  });

  test("review and all lift the needs-you row into the hero", () => {
    const reviewPR = pr(1, { author: "someone", reviewRequested: true });
    const reviewDeck = buildDeck([reviewPR], "review", viewer);
    expect(reviewDeck.hero).toEqual(reviewPR);
    expect(reviewDeck.heroKind).toBe("needs");
    expect(reviewDeck.buckets).toEqual([]);

    const allDeck = buildDeck([reviewPR], "all", viewer);
    expect(allDeck.hero).toEqual(reviewPR);
    expect(allDeck.heroKind).toBe("needs");
    expect(allDeck.buckets).toEqual([]);
  });

  test("all lifts only needs-you rows into the hero", () => {
    const waiting = pr(1, {
      author: "someone",
      reviewState: "review_required",
    });
    const deck = buildDeck([waiting], "all", viewer);
    expect(deck.hero).toBeNull();
    expect(deck.buckets.map((bucket) => bucket.id)).toEqual(["waiting"]);
  });

  test("canBeHero mirrors each tab's hero eligibility", () => {
    expect(canBeHero(pr(1), "mine", viewer)).toBe(true);
    expect(canBeHero(pr(1, { isDraft: true }), "mine", viewer)).toBe(true);
    expect(canBeHero(pr(1), "review", viewer)).toBe(true);
    expect(canBeHero(pr(1, { isDraft: true }), "review", viewer)).toBe(false);
    expect(
      canBeHero(
        pr(1, { author: "someone", reviewState: "approved" }),
        "all",
        viewer,
      ),
    ).toBe(false);
    expect(
      canBeHero(
        pr(1, { author: "someone", reviewRequested: true }),
        "all",
        viewer,
      ),
    ).toBe(true);
  });

  test("review and all never promote a draft", () => {
    const draft = pr(1, { author: "someone", isDraft: true });
    const reviewDeck = buildDeck([draft], "review", viewer);
    expect(reviewDeck.hero).toBeNull();
    expect(reviewDeck.buckets.map((bucket) => bucket.id)).toEqual(["drafts"]);

    const allDeck = buildDeck([draft], "all", viewer);
    expect(allDeck.hero).toBeNull();
    expect(allDeck.buckets.map((bucket) => bucket.id)).toEqual(["drafts"]);
  });
});
