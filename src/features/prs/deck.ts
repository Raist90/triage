import type { PR } from "../../lib/types";

/** Bucket ids are per tab; the same id always means the same predicate. */
export type DeckBucketID =
  "blocked" | "ready" | "waiting" | "review" | "needs" | "yours" | "drafts";

export type DeckSeverity = "blocked" | "warn" | "wait";

export type DeckBucket = {
  id: DeckBucketID;
  label: string;
  /** Rows in this bucket, already ordered. */
  rows: PR[];
};

/** A rendered row in cursor order. */
export type DeckRowRef = {
  pr: PR;
  bucket: DeckBucketID;
};

export type Deck = {
  buckets: DeckBucket[];
  /** Every row of every non-empty bucket, in visual order. */
  rows: DeckRowRef[];
};

type BucketDef = { id: DeckBucketID; label: string };

const BUCKETS: Record<string, BucketDef[]> = {
  mine: [
    { id: "blocked", label: "Blocked on you" },
    { id: "ready", label: "Ready to merge" },
    { id: "waiting", label: "Waiting on reviewers" },
    { id: "drafts", label: "Your drafts" },
  ],
  review: [
    { id: "review", label: "Needs your review" },
    { id: "drafts", label: "Drafts" },
  ],
  all: [
    { id: "needs", label: "Needs you" },
    { id: "yours", label: "Your PRs" },
    { id: "waiting", label: "Waiting on author" },
    { id: "drafts", label: "Drafts" },
  ],
};

const BUCKET_RANK: Record<string, Record<DeckBucketID, number>> = {
  mine: {
    blocked: 0,
    ready: 1,
    waiting: 2,
    drafts: 3,
    review: 99,
    needs: 99,
    yours: 99,
  },
  review: {
    review: 0,
    drafts: 1,
    blocked: 99,
    ready: 99,
    waiting: 99,
    needs: 99,
    yours: 99,
  },
  all: {
    needs: 0,
    yours: 1,
    waiting: 2,
    drafts: 3,
    blocked: 99,
    ready: 99,
    review: 99,
  },
};

const SEVERITY_RANK: Record<DeckSeverity, number> = {
  blocked: 0,
  warn: 1,
  wait: 2,
};

export function prKey(pr: Pick<PR, "repo" | "number">): string {
  return `${pr.repo}#${pr.number}`;
}

export function isDraft(pr: PR): boolean {
  return pr.isDraft;
}

export function isMine(pr: PR, viewer: string): boolean {
  return viewer !== "" && pr.author.toLowerCase() === viewer.toLowerCase();
}

function failing(pr: PR): boolean {
  return pr.checkStatus === "failure" || pr.checkStatus === "error";
}

function pending(pr: PR): boolean {
  return pr.checkStatus === "pending" || pr.checkStatus === "expected";
}

function blockedState(pr: PR): boolean {
  return pr.reviewState === "changes_requested" || failing(pr);
}

/** Bucket assignment. Drafts override every other assignment, in every tab. */
export function bucketFor(pr: PR, tab: string, viewer: string): DeckBucketID {
  if (isDraft(pr)) return "drafts";
  const mine = isMine(pr, viewer);

  if (tab === "mine") {
    if (blockedState(pr)) return "blocked";
    if (
      pr.reviewState === "approved" &&
      (pr.checkStatus === "success" || pr.checkStatus === "none")
    ) {
      return "ready";
    }
    return "waiting";
  }

  if (tab === "review") return "review";

  const needsYou = (mine && blockedState(pr)) || pr.reviewRequested === true;
  if (needsYou) return "needs";
  if (mine) return "yours";
  return "waiting";
}

/** The severity rail. Drafts have no severity. */
export function severityFor(pr: PR): DeckSeverity {
  if (blockedState(pr)) return "blocked";
  if (pr.reviewState === "review_required" || pending(pr)) return "warn";
  return "wait";
}

/** Exactly one reason string per row, first match wins. */
export function reasonFor(pr: PR): string {
  if (pr.reviewState === "changes_requested") return "changes requested";
  if (failing(pr)) return "checks failing";
  if (pr.reviewRequested) return "review requested";
  if (pending(pr)) return "checks running";
  if (pr.viewerReview === "approved") return "you approved";
  if (pr.viewerReview === "changes_requested") return "you requested changes";
  if (pr.reviewState === "approved") return "approved";
  if (pr.reviewState === "review_required") return "review required";
  return "no review yet";
}

/** Waiting buckets are de-emphasised; drafts never are. */
export function isDim(
  pr: PR,
  tab: string,
  bucket: DeckBucketID | null,
): boolean {
  if (!bucket || isDraft(pr)) return false;
  return (
    (tab === "mine" && bucket === "waiting") ||
    (tab === "all" && bucket === "waiting")
  );
}

function compareDrafts(a: PR, b: PR): number {
  return (
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.repo.localeCompare(b.repo) ||
    a.number - b.number
  );
}

function compareRows(a: PR, b: PR, tab: string, viewer: string): number {
  if (isDraft(a) && isDraft(b)) return compareDrafts(a, b);
  const rank = BUCKET_RANK[tab] ?? BUCKET_RANK.all;
  const bucketDelta =
    rank[bucketFor(a, tab, viewer)] - rank[bucketFor(b, tab, viewer)];
  if (bucketDelta !== 0) return bucketDelta;

  const severityDelta =
    SEVERITY_RANK[severityFor(a)] - SEVERITY_RANK[severityFor(b)];
  if (severityDelta !== 0) return severityDelta;

  return (
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.repo.localeCompare(b.repo) ||
    a.number - b.number
  );
}

/**
 * The list's current order. Bucket assignment is viewer-dependent only where
 * the tab uses `reviewRequested`; the comparator itself never needs the viewer.
 */
export function deckOrder(prs: PR[], tab: string, viewer: string): PR[] {
  return [...prs].sort((a, b) => compareRows(a, b, tab, viewer));
}

/**
 * Build the deck. `prs` must already be filtered and searched: bucket counts
 * and order describe the filtered set.
 */
export function buildDeck(prs: PR[], tab: string, viewer: string): Deck {
  const ordered = deckOrder(prs, tab, viewer);
  const groups = new Map<DeckBucketID, PR[]>();
  for (const pr of ordered) {
    const id = bucketFor(pr, tab, viewer);
    const rows = groups.get(id);
    if (rows) rows.push(pr);
    else groups.set(id, [pr]);
  }

  const buckets = (BUCKETS[tab] ?? BUCKETS.all)
    .map((def) => ({ ...def, rows: groups.get(def.id) ?? [] }))
    .filter((bucket) => bucket.rows.length > 0);

  const rows: DeckRowRef[] = [];
  for (const bucket of buckets) {
    for (const pr of bucket.rows) rows.push({ pr, bucket: bucket.id });
  }

  return { buckets, rows };
}
