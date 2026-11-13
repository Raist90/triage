import type { CheckState, PR, ReviewState } from "../../lib/types";
import type { PRFilterSection, PRFilters } from "../../stores/ui";

export const REVIEW_LABEL: Record<ReviewState, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
  none: "No review",
};

export const CHECK_LABEL: Record<CheckState, string> = {
  success: "Passing",
  failure: "Failing",
  pending: "Pending",
  expected: "Expected",
  error: "Error",
  none: "No checks",
};

// Canonical display order; rows only appear when their count is non-zero or the
// value is already selected (so a zeroed facet can always be toggled back off).
const REVIEW_ORDER: ReviewState[] = [
  "approved",
  "changes_requested",
  "review_required",
  "none",
];
const CHECK_ORDER: CheckState[] = [
  "success",
  "failure",
  "pending",
  "expected",
  "error",
  "none",
];

export type FacetOption = {
  value: string;
  label: string;
  count: number;
};

export type FilterChip = {
  key: string;
  label: string;
  section: PRFilterSection | "drafts";
  value: string;
  /** Clicking the chip clears the whole section instead of one value. */
  clearSection?: boolean;
};

const SECTION_CHIP_LABEL: Record<PRFilterSection, string> = {
  review: "Review",
  checks: "Checks",
  authors: "Authors",
  repos: "Repos",
};

function matchesQuery(pr: PR, query: string): boolean {
  return (
    pr.title.toLowerCase().includes(query) ||
    pr.author.toLowerCase().includes(query) ||
    pr.branch.toLowerCase().includes(query) ||
    pr.repo.toLowerCase().includes(query) ||
    `#${pr.number}`.includes(query)
  );
}

/** Within a section values are ORed; across sections they are ANDed. */
export function filterPRs(prs: PR[], filters: PRFilters): PR[] {
  const query = filters.query.trim().toLowerCase();
  return prs.filter((pr) => {
    if (filters.hideDrafts && pr.isDraft) return false;
    if (filters.review.length > 0 && !filters.review.includes(pr.reviewState))
      return false;
    if (filters.checks.length > 0 && !filters.checks.includes(pr.checkStatus))
      return false;
    if (filters.authors.length > 0 && !filters.authors.includes(pr.author))
      return false;
    if (filters.repos.length > 0 && !filters.repos.includes(pr.repo))
      return false;
    return query === "" || matchesQuery(pr, query);
  });
}

/**
 * Newest activity first. GitHub search returns relevance order, so the list has
 * to be ordered explicitly. Timestamps are ISO-8601 UTC, so string order is
 * chronological.
 */
export function sortPRs(prs: PR[]): PR[] {
  return [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** True when any facet constrains the list. Search is counted separately. */
export function hasFacetFilters(filters: PRFilters): boolean {
  return (
    filters.review.length > 0 ||
    filters.checks.length > 0 ||
    filters.authors.length > 0 ||
    filters.repos.length > 0 ||
    filters.hideDrafts
  );
}

/**
 * Chips in the order they appear in the filter strip. A section that selects
 * every option, or all but one or two, collapses to a single summary chip so a
 * "select all, then hide one author" filter does not flood the strip.
 */
export function filterChips(prs: PR[], filters: PRFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  const counts = facetCounts(prs, filters);

  const sections: Array<{
    section: PRFilterSection;
    values: string[];
    options: FacetOption[];
  }> = [
    { section: "review", values: filters.review, options: counts.review },
    { section: "checks", values: filters.checks, options: counts.checks },
    { section: "authors", values: filters.authors, options: counts.authors },
    { section: "repos", values: filters.repos, options: counts.repos },
  ];

  for (const { section, values, options } of sections) {
    if (values.length === 0) continue;

    const selected = new Set(values);
    const labels = new Map(
      options.map((option) => [option.value, option.label]),
    );
    const universe = options.map((option) => option.value);
    const missing = universe.filter((value) => !selected.has(value));
    const labelOf = (value: string) => labels.get(value) ?? value;

    if (universe.length > 0 && missing.length === 0) {
      chips.push({
        key: `${section}:all`,
        label: `${SECTION_CHIP_LABEL[section]}: all`,
        section,
        value: "",
        clearSection: true,
      });
    } else if (missing.length > 0 && missing.length <= 2) {
      chips.push({
        key: `${section}:except`,
        label: `Except ${missing.map(labelOf).join(", ")}`,
        section,
        value: "",
        clearSection: true,
      });
    } else if (values.length > 4) {
      chips.push({
        key: `${section}:count`,
        label: `${SECTION_CHIP_LABEL[section]}: ${values.length} selected`,
        section,
        value: "",
        clearSection: true,
      });
    } else {
      for (const value of values) {
        chips.push({
          key: `${section}:${value}`,
          label: labelOf(value),
          section,
          value,
        });
      }
    }
  }

  if (filters.hideDrafts) {
    chips.push({
      key: "drafts:hide",
      label: "Hide drafts",
      section: "drafts",
      value: "",
    });
  }
  return chips;
}

type FacetCounts = Record<PRFilterSection, FacetOption[]>;

/**
 * Counts per facet. Each section is counted with every *other* dimension
 * applied, so numbers stay truthful as the user toggles siblings.
 */
export function facetCounts(prs: PR[], filters: PRFilters): FacetCounts {
  function scoped(section: PRFilterSection): PR[] {
    return filterPRs(prs, {
      ...filters,
      review: section === "review" ? [] : filters.review,
      checks: section === "checks" ? [] : filters.checks,
      authors: section === "authors" ? [] : filters.authors,
      repos: section === "repos" ? [] : filters.repos,
    });
  }

  const reviewRows = scoped("review");
  const checkRows = scoped("checks");
  const authorRows = scoped("authors");
  const repoRows = scoped("repos");

  const review = REVIEW_ORDER.map((value) => ({
    value,
    label: REVIEW_LABEL[value],
    count: reviewRows.filter((pr) => pr.reviewState === value).length,
  })).filter(
    (option) =>
      option.count > 0 || filters.review.includes(option.value as ReviewState),
  );

  const checks = CHECK_ORDER.map((value) => ({
    value,
    label: CHECK_LABEL[value],
    count: checkRows.filter((pr) => pr.checkStatus === value).length,
  })).filter(
    (option) =>
      option.count > 0 || filters.checks.includes(option.value as CheckState),
  );

  return {
    review,
    checks,
    authors: groupCounts(
      authorRows.map((pr) => pr.author),
      filters.authors,
    ),
    repos: groupCounts(
      repoRows.map((pr) => pr.repo),
      filters.repos,
    ),
  };
}

function groupCounts(values: string[], selected: string[]): FacetOption[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  for (const value of selected) {
    if (!counts.has(value)) counts.set(value, 0);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
