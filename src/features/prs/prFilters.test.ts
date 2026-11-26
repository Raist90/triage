import { describe, expect, test } from "bun:test";
import { makePR } from "../../test/fixtures";
import { EMPTY_PR_FILTERS } from "../../stores/ui";
import {
  facetCounts,
  filterChips,
  filterPRs,
  hasFacetFilters,
} from "./prFilters";

const prs = [
  makePR({
    number: 1,
    title: "Add checkout",
    author: "alice",
    branch: "feat/checkout",
    repo: "acme/web",
    checkStatus: "success",
    reviewState: "approved",
    updatedAt: "2026-06-15T10:00:00Z",
  }),
  makePR({
    number: 2,
    title: "Fix header",
    author: "bob",
    branch: "fix/header",
    repo: "acme/api",
    checkStatus: "failure",
    reviewState: "changes_requested",
    updatedAt: "2026-06-15T11:00:00Z",
  }),
  makePR({
    number: 3,
    title: "Draft docs",
    author: "alice",
    branch: "docs",
    repo: "acme/web",
    checkStatus: "success",
    reviewState: "review_required",
    isDraft: true,
    updatedAt: "2026-06-15T09:00:00Z",
  }),
];

describe("filterPRs", () => {
  test("ORs values within a section and ANDs across sections", () => {
    expect(
      filterPRs(prs, {
        ...EMPTY_PR_FILTERS,
        review: ["approved", "changes_requested"],
      }).map((pr) => pr.number),
    ).toEqual([1, 2]);

    expect(
      filterPRs(prs, {
        ...EMPTY_PR_FILTERS,
        review: ["approved", "changes_requested"],
        authors: ["alice"],
      }).map((pr) => pr.number),
    ).toEqual([1]);
  });

  test("searches title, author, branch, repo and PR number", () => {
    const numbers = (query: string) =>
      filterPRs(prs, { ...EMPTY_PR_FILTERS, query }).map((pr) => pr.number);

    expect(numbers("header")).toEqual([2]);
    expect(numbers("bob")).toEqual([2]);
    expect(numbers("feat/checkout")).toEqual([1]);
    expect(numbers("acme/api")).toEqual([2]);
    expect(numbers("#3")).toEqual([3]);
  });

  test("hides drafts only when the toggle is on", () => {
    expect(
      filterPRs(prs, { ...EMPTY_PR_FILTERS, hideDrafts: true }).map(
        (pr) => pr.number,
      ),
    ).toEqual([1, 2]);
  });
});

describe("filterChips", () => {
  test("describes a selection that leaves one option out", () => {
    const chips = filterChips(prs, {
      ...EMPTY_PR_FILTERS,
      authors: ["alice"],
    });
    expect(chips).toEqual([
      {
        key: "authors:except",
        label: "Except bob",
        section: "authors",
        value: "",
        clearSection: true,
      },
    ]);
  });

  test("collapses a fully selected facet to one chip", () => {
    const chips = filterChips(prs, {
      ...EMPTY_PR_FILTERS,
      authors: ["alice", "bob"],
    });
    expect(chips).toEqual([
      {
        key: "authors:all",
        label: "Authors: all",
        section: "authors",
        value: "",
        clearSection: true,
      },
    ]);
  });

  test("describes an all-but-one selection as 'Except'", () => {
    const chips = filterChips(prs, {
      ...EMPTY_PR_FILTERS,
      review: ["approved", "changes_requested"],
    });
    expect(chips.map((chip) => chip.label)).toEqual(["Except Review required"]);
  });

  test("adds a drafts chip and ignores the search query", () => {
    expect(
      filterChips(prs, { ...EMPTY_PR_FILTERS, query: "checkout" }),
    ).toEqual([]);
    expect(filterChips(prs, { ...EMPTY_PR_FILTERS, hideDrafts: true })).toEqual(
      [
        {
          key: "drafts:hide",
          label: "Hide drafts",
          section: "drafts",
          value: "",
        },
      ],
    );
  });
});

describe("facetCounts", () => {
  test("counts each facet with every other facet applied", () => {
    const counts = facetCounts(prs, {
      ...EMPTY_PR_FILTERS,
      authors: ["bob"],
    });
    expect(counts.checks.map((option) => option.value)).toEqual(["failure"]);
    expect(counts.checks[0]?.count).toBe(1);
    expect(counts.authors.map((option) => option.value)).toEqual([
      "alice",
      "bob",
    ]);
  });
});

describe("hasFacetFilters", () => {
  test("ignores search and reacts to every facet", () => {
    expect(hasFacetFilters({ ...EMPTY_PR_FILTERS, query: "checkout" })).toBe(
      false,
    );
    expect(hasFacetFilters({ ...EMPTY_PR_FILTERS, hideDrafts: true })).toBe(
      true,
    );
    expect(hasFacetFilters({ ...EMPTY_PR_FILTERS, checks: ["failure"] })).toBe(
      true,
    );
  });
});
