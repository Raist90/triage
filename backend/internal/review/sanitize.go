package review

import (
	"fmt"
	"sort"
	"strings"

	"github.com/Raist90/triage/backend/internal/diff"
)

const (
	maxFindings = 12
	maxPraise   = 2

	maxTitleRunes          = 80
	maxClaimRunes          = 320
	maxSuggestionRunes     = 480
	maxEntityRunes         = 120
	maxEvidenceRunes       = 400
	maxGuidelineRunes      = 120
	maxGuidelineQuoteRunes = 400
	maxSummaryRunes        = 240
)

// Reasons a finding is hidden. They are part of the artifact and stable on
// purpose: changing one is a contract change, not a wording tweak.
const (
	reasonInvalidField       = "invalid_field"
	reasonSeverityRule       = "severity_rule"
	reasonGuidelineMismatch  = "guideline_mismatch"
	reasonFileNotChanged     = "file_not_changed"
	reasonNoEvidence         = "no_evidence"
	reasonEvidenceNotChanged = "evidence_not_changed"
	reasonDuplicate          = "duplicate"
	reasonCap                = "cap"
)

// Grounding is the server-side truth a review is checked against. Files is the
// parsed pull request diff, including sem's entity ranges. Guidelines is the
// exact text read from the repository's convention documents.
type Grounding struct {
	Files      []diff.File
	Guidelines string
}

// Sanitize enforces the output contract on a parsed review: known enums, string
// limits, dedupe, the 12-finding and 2-praise caps, evidence grounding against
// the real diff and sem's changed entities, server-owned lines and IDs, and the
// verdict override.
//
// The model never supplies a line number. It quotes a changed line, and the
// server resolves the line from that quote. A finding whose quote is not on the
// changed side of the diff is hidden and counted. Convention findings must also
// quote a real guideline rule. Every hidden finding is recorded in Dropped.
func Sanitize(r Review, grounding Grounding) Review {
	out := Review{Omitted: r.Omitted}
	index := buildGroundIndex(grounding.Files)
	seen := make(map[string]struct{}, len(r.Findings))
	kept := make([]Finding, 0, len(r.Findings))

	drop := func(finding Finding, reason string) {
		out.Dropped = append(out.Dropped, DroppedFinding{
			Title:          finding.Title,
			Severity:       finding.Severity,
			File:           finding.File,
			Line:           finding.Line,
			Evidence:       finding.Evidence,
			Guideline:      finding.Guideline,
			GuidelineQuote: finding.GuidelineQuote,
			Reason:         reason,
		})
	}

	for _, finding := range r.Findings {
		finding.Title = clampRunes(finding.Title, maxTitleRunes)
		finding.Claim = clampRunes(finding.Claim, maxClaimRunes)
		finding.Suggestion = clampRunes(finding.Suggestion, maxSuggestionRunes)
		finding.Entity = clampRunes(finding.Entity, maxEntityRunes)
		finding.Evidence = clampRunes(finding.Evidence, maxEvidenceRunes)
		finding.Guideline = clampRunes(finding.Guideline, maxGuidelineRunes)
		finding.GuidelineQuote = clampRunes(finding.GuidelineQuote, maxGuidelineQuoteRunes)
		finding.File = normalizeFindingPath(finding.File)

		if !finding.Severity.Valid() || !finding.Category.Valid() {
			drop(finding, reasonInvalidField)
			continue
		}
		if finding.Category == CategoryConventions && finding.Severity == SeverityBlocking {
			drop(finding, reasonSeverityRule)
			continue
		}
		if finding.Category == CategoryConventions {
			path, ok := resolveGuidelineQuote(grounding.Guidelines, finding.GuidelineQuote)
			if !ok {
				drop(finding, reasonGuidelineMismatch)
				continue
			}
			finding.Guideline = path
		}

		grounded, reason := index.ground(finding)
		if reason != "" {
			out.Unverified++
			if finding.Severity == SeverityBlocking {
				out.UnverifiedBlocking++
			}
			drop(finding, reason)
			continue
		}

		key := dedupeKey(grounded)
		if _, duplicate := seen[key]; duplicate {
			out.Omitted++
			drop(grounded, reasonDuplicate)
			continue
		}
		seen[key] = struct{}{}
		kept = append(kept, grounded)
	}

	// Highest severity first, then a stable file, line and title order so two
	// runs over the same findings produce the same list and IDs.
	sort.SliceStable(kept, func(i, j int) bool {
		left, right := kept[i], kept[j]
		if severityRank(left.Severity) != severityRank(right.Severity) {
			return severityRank(left.Severity) < severityRank(right.Severity)
		}
		if left.File != right.File {
			return left.File < right.File
		}
		if left.Line != right.Line {
			return left.Line < right.Line
		}
		return left.Title < right.Title
	})
	if len(kept) > maxFindings {
		for _, finding := range kept[maxFindings:] {
			out.Omitted++
			drop(finding, reasonCap)
		}
		kept = kept[:maxFindings]
	}

	// Praise is the most common noise, so it is capped after the severity sort
	// has already put the useful findings first.
	praise := 0
	findings := make([]Finding, 0, len(kept))
	for _, finding := range kept {
		if finding.Severity == SeverityPraise {
			praise++
			if praise > maxPraise {
				out.Omitted++
				drop(finding, reasonCap)
				continue
			}
		}
		findings = append(findings, finding)
	}

	blocking := false
	for index := range findings {
		findings[index].ID = fmt.Sprintf("F%d", index+1)
		findings[index].Anchored = true
		if findings[index].Severity == SeverityBlocking {
			blocking = true
		}
	}
	out.Findings = findings

	out.Verdict.SafeToMerge = r.Verdict.SafeToMerge
	out.Verdict.Summary = clampRunes(strings.TrimSpace(r.Verdict.Summary), maxSummaryRunes)
	if out.Verdict.Summary == "" {
		switch {
		case len(findings) == 0 && out.UnverifiedBlocking > 0:
			out.Verdict.Summary = "A blocking finding could not be verified against the changed code."
		case len(findings) == 0 && out.Unverified > 0:
			out.Verdict.Summary = "No finding could be verified against the changed code."
		default:
			out.Verdict.Summary = fallbackSummary(findings)
		}
	}

	// The server owns safeToMerge: a blocking finding always wins, and an empty
	// review with a false verdict is contradictory because nothing is actionable.
	// A hidden blocking finding is different: the model still called it blocking,
	// so the verdict stays conservative instead of flipping to safe.
	if blocking || out.UnverifiedBlocking > 0 {
		if out.Verdict.SafeToMerge {
			out.Verdict.Overridden = true
		}
		out.Verdict.SafeToMerge = false
	}
	if len(findings) == 0 && !out.Verdict.SafeToMerge && out.UnverifiedBlocking == 0 {
		out.Verdict.SafeToMerge = true
		out.Verdict.Overridden = true
	}
	return out
}

func severityRank(severity Severity) int {
	switch severity {
	case SeverityBlocking:
		return 0
	case SeverityWarning:
		return 1
	case SeverityNitpick:
		return 2
	default:
		return 3
	}
}

func fallbackSummary(findings []Finding) string {
	if len(findings) == 0 {
		return "Review completed."
	}
	counts := map[Severity]int{}
	for _, finding := range findings {
		counts[finding.Severity]++
	}
	parts := make([]string, 0, 4)
	for _, severity := range []Severity{SeverityBlocking, SeverityWarning, SeverityNitpick, SeverityPraise} {
		if counts[severity] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", counts[severity], severity))
		}
	}
	return fmt.Sprintf("Review found %s.", strings.Join(parts, ", "))
}

// resolveGuidelineQuote finds the guideline section that contains the quoted
// rule and returns its path. The quote is the evidence: a model that names the
// wrong file or formats the path differently still keeps a real rule, while an
// invented rule is rejected. The first section in reading order wins.
func resolveGuidelineQuote(guidelines, raw string) (string, bool) {
	quote := normalizeWhitespace(raw)
	if quote == "" {
		return "", false
	}
	var (
		path  string
		body  []string
		check = func() bool {
			return path != "" &&
				strings.Contains(normalizeWhitespace(strings.Join(body, "\n")), quote)
		}
	)
	for _, line := range strings.Split(guidelines, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			if check() {
				return path, true
			}
			path = normalizeFindingPath(strings.TrimPrefix(trimmed, "## "))
			body = body[:0]
			continue
		}
		if path != "" {
			body = append(body, line)
		}
	}
	if check() {
		return path, true
	}
	return "", false
}

// normalizeFindingPath puts a model-supplied path into the same shape diff.Parse
// uses: no a/ or b/ prefix, no redundant segments.
func normalizeFindingPath(name string) string {
	value := strings.TrimSpace(name)
	value = strings.Trim(value, "`")
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "a/")
	value = strings.TrimPrefix(value, "b/")
	value = strings.TrimPrefix(value, "./")
	for strings.Contains(value, "//") {
		value = strings.ReplaceAll(value, "//", "/")
	}
	return value
}

// normalizeWhitespace makes copied code comparable without letting indentation
// or spacing changes hide a mismatch.
func normalizeWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func dedupeKey(finding Finding) string {
	return strings.Join([]string{
		finding.File,
		normalizeEntityName(finding.Entity),
		string(finding.Category),
		normalizeWhitespace(strings.ToLower(finding.Title)),
	}, "\x00")
}

func clampRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit]))
}
