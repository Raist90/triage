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
// limits, dedupe, the 12-finding and 2-praise caps, grounding against the real
// diff and sem's changed entities, server-owned IDs and the verdict override.
//
// A finding that cannot be tied to the pull request is hidden and counted. The
// model is untrusted, so a confident claim about a file, entity or line that
// never changed must not reach the UI as evidence.
func Sanitize(r Review, files []diff.File) Review {
	out := Review{Omitted: r.Omitted}
	index := buildGroundIndex(files)
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

		grounded, ok := index.ground(finding)
		if !ok {
			out.Unverified++
			if finding.Severity == SeverityBlocking {
				out.UnverifiedBlocking++
			}
			continue
		}
		if grounded.EndLine < grounded.Line {
			grounded.EndLine = 0
		}

		key := fmt.Sprintf("%s\x00%d\x00%s", grounded.File, grounded.Line, grounded.Title)
		if _, duplicate := seen[key]; duplicate {
			out.Omitted++
			continue
		}
		seen[key] = struct{}{}
		kept = append(kept, grounded)
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

	blocking := false
	for index := range findings {
		findings[index].ID = fmt.Sprintf("F%d", index+1)
		// Grounding only keeps a finding whose line is on a hunk.
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

// groundIndex resolves a finding against the diff and sem's entity changes.
// The model may cite a file, entity or line that does not exist or that the
// pull request never changed; grounding turns that into a hidden finding
// instead of a confident snippet.
type groundIndex struct {
	files map[string]*groundFile
}

type groundFile struct {
	Path     string
	NewLines map[int]bool
	OldLines map[int]bool
	entities map[string]diff.SemanticChange
}

func buildGroundIndex(files []diff.File) *groundIndex {
	index := &groundIndex{files: make(map[string]*groundFile, len(files)*2)}
	for _, file := range files {
		ground := newGroundFile(file)
		if path := normalizeFindingPath(file.Path); path != "" {
			index.files[path] = ground
		}
		if path := normalizeFindingPath(file.OldPath); path != "" {
			index.files[path] = ground
		}
	}
	return index
}

func newGroundFile(file diff.File) *groundFile {
	hunks := file.Hunks
	if len(hunks) == 0 {
		hunks = diff.BuildHunksFor(file.Path, file.Patch)
	}
	ground := &groundFile{
		Path:     file.Path,
		NewLines: make(map[int]bool),
		OldLines: make(map[int]bool),
		entities: make(map[string]diff.SemanticChange),
	}
	for _, hunk := range hunks {
		for _, line := range hunk.Lines {
			if line.NewNumber > 0 {
				ground.NewLines[line.NewNumber] = true
			}
			if line.OldNumber > 0 {
				ground.OldLines[line.OldNumber] = true
			}
		}
	}
	for _, change := range file.Semantic {
		name := normalizeEntityName(change.EntityName)
		if name == "" {
			continue
		}
		if _, exists := ground.entities[name]; exists {
			continue
		}
		ground.entities[name] = change
	}
	return ground
}

// ground returns the finding with a line that exists on the changed file, or
// false when the citation cannot be tied to the pull request.
func (g *groundIndex) ground(finding Finding) (Finding, bool) {
	file, ok := g.files[normalizeFindingPath(finding.File)]
	if !ok {
		return finding, false
	}
	finding.File = file.Path
	if finding.Line <= 0 {
		return finding, false
	}

	if change, matched := file.matchEntity(finding.Entity, finding.Line); matched {
		line, snapped := file.snapLine(change, finding.Line)
		if !snapped {
			return finding, false
		}
		finding.Line = line
		finding.Entity = change.EntityName
		return finding, true
	}

	// No sem entity matched. The line still has to be part of a hunk; a model
	// that cites code outside the diff is pointing at something this pull
	// request did not change.
	if !file.hasLine(finding.Line) {
		return finding, false
	}
	return finding, true
}

func (f *groundFile) hasLine(line int) bool {
	return f.NewLines[line] || f.OldLines[line]
}

func changeRange(change diff.SemanticChange) (int, int) {
	if change.StartLine > 0 {
		end := change.EndLine
		if end < change.StartLine {
			end = change.StartLine
		}
		return change.StartLine, end
	}
	if change.OldStartLine > 0 {
		end := change.OldEndLine
		if end < change.OldStartLine {
			end = change.OldStartLine
		}
		return change.OldStartLine, end
	}
	return 0, 0
}

func (f *groundFile) matchEntity(raw string, cited int) (diff.SemanticChange, bool) {
	var best diff.SemanticChange
	bestDistance := 0
	found := false
	for _, candidate := range entityCandidates(raw) {
		change, ok := f.entities[normalizeEntityName(candidate)]
		if !ok {
			continue
		}
		distance := changeDistance(change, cited)
		if !found || distance < bestDistance {
			best = change
			bestDistance = distance
			found = true
		}
	}
	return best, found
}

// snapLine keeps the cited line when it is a changed line inside the entity and
// otherwise moves it to the nearest changed line the entity contains. The result
// is always a hunk line, so the snippet and the jump land on real evidence.
func (f *groundFile) snapLine(change diff.SemanticChange, cited int) (int, bool) {
	start, end := changeRange(change)
	if start <= 0 {
		return 0, false
	}
	source := f.NewLines
	if change.StartLine <= 0 {
		source = f.OldLines
	}

	best := 0
	bestDistance := 0
	if source[cited] && cited >= start && cited <= end {
		return cited, true
	}
	for line := range source {
		if line < start || line > end {
			continue
		}
		distance := absInt(line - cited)
		if best == 0 || distance < bestDistance || (distance == bestDistance && line < best) {
			best = line
			bestDistance = distance
		}
	}
	return best, best != 0
}

func changeDistance(change diff.SemanticChange, line int) int {
	start, end := changeRange(change)
	if start <= 0 {
		return int(^uint(0) >> 1)
	}
	switch {
	case line < start:
		return start - line
	case line > end:
		return line - end
	default:
		return 0
	}
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func normalizeEntityName(name string) string {
	return strings.ToLower(strings.TrimSpace(strings.Trim(name, "`")))
}

// entityCandidates handles models that join several entity names in one string,
// such as "configView / repoReview". The full string is tried first.
func entityCandidates(raw string) []string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil
	}
	seen := make(map[string]bool)
	out := make([]string, 0, 4)
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		key := normalizeEntityName(name)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, name)
	}
	add(value)
	for _, separator := range []string{" / ", " · ", ",", "/"} {
		if !strings.Contains(value, separator) {
			continue
		}
		for _, part := range strings.Split(value, separator) {
			add(part)
		}
	}
	return out
}
