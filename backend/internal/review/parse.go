package review

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/Raist90/triage/backend/internal/diff"
)

const (
	maxFindings = 12
	maxPraise   = 2

	maxTitleRunes      = 80
	maxClaimRunes      = 320
	maxSuggestionRunes = 480
	maxEntityRunes     = 120
	maxSummaryRunes    = 240
	maxPatchBytes      = 8 << 10

	// maxAnchorDistance is how far a finding may sit from a hunk and still get
	// a snippet in the UI. Beyond it the finding is kept but unanchored.
	maxAnchorDistance = 40
)

// Parse turns the model's answer into a Review. structured is the result
// event's structured_output, which the CLI returns when --json-schema is in
// effect. text is the plain result field, which carries the same object as
// prose or a fenced block on CLI versions that do not emit structured_output.
// The structured field wins; text is the fallback.
func Parse(structured json.RawMessage, text string) (Review, error) {
	if len(structured) > 0 && !isJSONNull(structured) {
		var parsed Review
		if err := json.Unmarshal(structured, &parsed); err == nil {
			return parsed, nil
		}
	}

	candidate := extractJSONObject(text)
	if candidate == "" {
		return Review{}, errors.New("review: model output has no JSON object")
	}
	var parsed Review
	if err := json.Unmarshal([]byte(candidate), &parsed); err != nil {
		return Review{}, fmt.Errorf("review: decode model output: %w", err)
	}
	return parsed, nil
}

func isJSONNull(raw json.RawMessage) bool {
	return strings.TrimSpace(string(raw)) == "null"
}

// extractJSONObject strips an optional markdown fence and returns the substring
// from the first { to the last }. Prose around the object is discarded.
func extractJSONObject(text string) string {
	value := strings.TrimSpace(text)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "```") {
		if index := strings.IndexByte(value, '\n'); index >= 0 {
			value = value[index+1:]
		} else {
			return ""
		}
	}
	value = strings.TrimSpace(value)
	if strings.HasSuffix(value, "```") {
		value = strings.TrimSpace(strings.TrimSuffix(value, "```"))
	}
	start := strings.IndexByte(value, '{')
	end := strings.LastIndexByte(value, '}')
	if start < 0 || end <= start {
		return ""
	}
	return value[start : end+1]
}

// Sanitize enforces the output contract on a parsed review: known enums, string
// limits, dedupe, the 12-finding and 2-praise caps, anchors against the real
// diff, server-owned IDs and the verdict override. A finding is never dropped
// for a bad anchor; it is kept and rendered without a snippet.
func Sanitize(r Review, files []diff.File) Review {
	out := Review{Omitted: r.Omitted}
	seen := make(map[string]struct{}, len(r.Findings))
	kept := make([]Finding, 0, len(r.Findings))

	for _, finding := range r.Findings {
		if !finding.Severity.Valid() || !finding.Category.Valid() {
			out.Omitted++
			continue
		}
		finding.Title = clampRunes(finding.Title, maxTitleRunes)
		finding.Claim = clampRunes(finding.Claim, maxClaimRunes)
		finding.Suggestion = clampRunes(finding.Suggestion, maxSuggestionRunes)
		finding.Entity = clampRunes(finding.Entity, maxEntityRunes)
		finding.Patch = clampBytes(finding.Patch, maxPatchBytes)
		finding.File = normalizeFindingPath(finding.File)
		if finding.EndLine < finding.Line {
			finding.EndLine = 0
		}

		key := fmt.Sprintf("%s\x00%d\x00%s", finding.File, finding.Line, finding.Title)
		if _, duplicate := seen[key]; duplicate {
			out.Omitted++
			continue
		}
		seen[key] = struct{}{}
		kept = append(kept, finding)
	}

	// Highest severity first, model order preserved inside a severity.
	sort.SliceStable(kept, func(i, j int) bool {
		return severityRank(kept[i].Severity) < severityRank(kept[j].Severity)
	})
	if len(kept) > maxFindings {
		out.Omitted += len(kept) - maxFindings
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
				continue
			}
		}
		findings = append(findings, finding)
	}

	anchors := buildAnchorIndex(files)
	blocking := false
	for index := range findings {
		findings[index].ID = fmt.Sprintf("F%d", index+1)
		findings[index].Anchored = anchors.contains(findings[index].File, findings[index].Line)
		if findings[index].Severity == SeverityBlocking {
			blocking = true
		}
	}
	out.Findings = findings

	out.Verdict.SafeToMerge = r.Verdict.SafeToMerge
	out.Verdict.Summary = clampRunes(strings.TrimSpace(r.Verdict.Summary), maxSummaryRunes)
	if out.Verdict.Summary == "" {
		out.Verdict.Summary = fallbackSummary(findings)
	}

	// The server owns safeToMerge: a blocking finding always wins, and an empty
	// review with a false verdict is contradictory because nothing is actionable.
	if blocking {
		if out.Verdict.SafeToMerge {
			out.Verdict.Overridden = true
		}
		out.Verdict.SafeToMerge = false
	}
	if len(findings) == 0 && !out.Verdict.SafeToMerge {
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

func clampBytes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

// anchorIndex answers "is this finding on or near a changed hunk". Hunks are
// built lazily per file so a review that cites one file does not parse the rest.
type anchorIndex struct {
	hunks map[string][]diff.Hunk
	built map[string]bool
	files map[string]diff.File
}

func buildAnchorIndex(files []diff.File) *anchorIndex {
	index := &anchorIndex{
		hunks: make(map[string][]diff.Hunk, len(files)),
		built: make(map[string]bool, len(files)),
		files: make(map[string]diff.File, len(files)),
	}
	for _, file := range files {
		index.files[normalizeFindingPath(file.Path)] = file
		if file.OldPath != "" {
			index.files[normalizeFindingPath(file.OldPath)] = file
		}
	}
	return index
}

func (a *anchorIndex) contains(path string, line int) bool {
	if line <= 0 {
		return false
	}
	file, ok := a.files[normalizeFindingPath(path)]
	if !ok {
		return false
	}
	hunks := a.hunksFor(file)
	if len(hunks) == 0 {
		return false
	}

	distance := maxAnchorDistance + 1
	for _, hunk := range hunks {
		start := hunk.NewStart
		end := hunk.NewStart + hunk.NewCount - 1
		if hunk.NewCount <= 0 {
			end = start
		}
		switch {
		case line >= start && line <= end:
			return true
		case line < start:
			if start-line < distance {
				distance = start - line
			}
		case line > end:
			if line-end < distance {
				distance = line - end
			}
		}
	}
	return distance <= maxAnchorDistance
}

func (a *anchorIndex) hunksFor(file diff.File) []diff.Hunk {
	key := normalizeFindingPath(file.Path)
	if a.built[key] {
		return a.hunks[key]
	}
	a.built[key] = true
	if len(file.Hunks) > 0 {
		a.hunks[key] = file.Hunks
		return a.hunks[key]
	}
	a.hunks[key] = diff.BuildHunksFor(file.Path, file.Patch)
	return a.hunks[key]
}
