package diff

import (
	"math"
)

// Review is the deterministic focus score for one file. It is a ranking hint,
// not a verdict: the signals explain why the file rose to the top, and the score
// keeps the sidebar stable across renders.
type Review struct {
	Score   int           `json:"score"`
	Band    string        `json:"band"`
	Changes ChangeCounts  `json:"changes"`
	Signals ReviewSignals `json:"signals"`
}

// ChangeCounts mirrors the sem change types after cosmetic changes are split
// out. It lets the UI describe a file without re-walking its semantic changes.
type ChangeCounts struct {
	Added    int `json:"added,omitempty"`
	Modified int `json:"modified,omitempty"`
	Deleted  int `json:"deleted,omitempty"`
	Moved    int `json:"moved,omitempty"`
	Cosmetic int `json:"cosmetic,omitempty"`
}

// ReviewSignals are the explanations behind a score. Counts stay numeric so the
// frontend owns the copy.
type ReviewSignals struct {
	Deletes       int  `json:"deletes,omitempty"`
	Rewrites      int  `json:"rewrites,omitempty"`
	RenameRipples int  `json:"renameRipples,omitempty"`
	CosmeticOnly  bool `json:"cosmeticOnly,omitempty"`
	ModuleOnly    bool `json:"moduleOnly,omitempty"`
	NoTestChange  bool `json:"noTests,omitempty"`
}

const (
	bandHigh   = "high"
	bandMedium = "medium"
	bandLow    = "low"

	// scoreScale maps raw entity points onto the 0-100 band space. Tuned so a
	// single deleted entity lands at medium and a handful of deleted or
	// rewritten entities reach high.
	scoreScale = 8.0
)

var changeWeights = map[string]float64{
	"deleted":   3,
	"modified":  2,
	"added":     1.5,
	"moved":     0.75,
	"renamed":   0.75,
	"reordered": 0.25,
}

// Prioritize fills Review for every file. It runs even when sem is missing:
// the fallback ranks by churn so the sidebar still has a useful default order.
func Prioritize(files []File) {
	touchedBy := make(map[string]map[int]struct{})
	for index := range files {
		for _, change := range files[index].Semantic {
			if change.Cosmetic {
				continue
			}
			for _, name := range []string{change.EntityName, change.OldEntityName} {
				if name == "" {
					continue
				}
				if touchedBy[name] == nil {
					touchedBy[name] = make(map[int]struct{})
				}
				touchedBy[name][index] = struct{}{}
			}
		}
	}

	hasTestFile := false
	for index := range files {
		files[index].Review = reviewFile(files[index], index, touchedBy)
		if contains(files[index].Kinds, KindTest) {
			hasTestFile = true
		}
	}

	if hasTestFile {
		return
	}
	for index := range files {
		review := files[index].Review
		if review == nil || isNonSource(files[index].Kinds) {
			continue
		}
		if review.Changes.Added+review.Changes.Modified+review.Changes.Deleted > 0 {
			review.Signals.NoTestChange = true
		}
	}
}

func reviewFile(file File, index int, touchedBy map[string]map[int]struct{}) *Review {
	review := &Review{Band: bandLow}
	points := 0.0
	cosmetic := 0

	for _, change := range file.Semantic {
		countChange(&review.Changes, change.ChangeType, change.Cosmetic)
		if change.Cosmetic {
			cosmetic++
			continue
		}

		weight := changeWeights[change.ChangeType]
		if weight == 0 {
			weight = 1
		}
		if change.EntityType == "orphan" {
			weight *= 0.5
		}
		changePoints := weight * churnFactor(change)
		if change.ChangeType == "modified" && isRewrite(change) {
			changePoints *= 1.4
			review.Signals.Rewrites++
		}
		if change.ChangeType == "deleted" {
			review.Signals.Deletes++
		}
		changePoints += float64(renameRipples(change, index, touchedBy, review))
		points += changePoints
	}

	if len(file.Semantic) == 0 {
		// No sem report for this file: fall back to churn so the ranking still
		// puts large or removed files first.
		points = math.Sqrt(float64(file.Additions+file.Deletions)) * 0.75
	}

	review.Signals.CosmeticOnly = len(file.Semantic) > 0 && cosmetic == len(file.Semantic)
	review.Signals.ModuleOnly = moduleOnly(file.Semantic)

	factor := kindFactor(file.Kinds) * statusFactor(file.Status)
	if factor == 0 {
		review.Score = 0
		return review
	}
	score := int(math.Round(points * factor * scoreScale))
	if score > 100 {
		score = 100
	}
	if score < 0 {
		score = 0
	}
	review.Score = score
	switch {
	case score >= 55:
		review.Band = bandHigh
	case score >= 20:
		review.Band = bandMedium
	}
	return review
}

func countChange(counts *ChangeCounts, changeType string, cosmetic bool) {
	if cosmetic {
		counts.Cosmetic++
		return
	}
	switch changeType {
	case "added":
		counts.Added++
	case "modified":
		counts.Modified++
	case "deleted":
		counts.Deleted++
	case "moved", "renamed", "reordered":
		counts.Moved++
	}
}

// churnFactor rewards entities that changed many lines, with a hard ceiling so
// one giant entity cannot bury every other file.
func churnFactor(change SemanticChange) float64 {
	return 1 + math.Min(0.5, float64(changedLines(change))/100)
}

func changedLines(change SemanticChange) int {
	start, end := change.StartLine, change.EndLine
	if start <= 0 {
		start, end = change.OldStartLine, change.OldEndLine
	}
	if start <= 0 {
		return 0
	}
	if end < start {
		end = start
	}
	return end - start + 1
}

func isRewrite(change SemanticChange) bool {
	if change.before == "" || change.after == "" {
		return false
	}
	return contentSimilarity(change.before, change.after) < 0.5
}

// renameRipples counts other changed files that mention the old entity name.
// A rename that only touches one file is local churn; one that ripples across
// files is where review attention pays off.
func renameRipples(change SemanticChange, index int, touchedBy map[string]map[int]struct{}, review *Review) int {
	name := change.OldEntityName
	if name == "" && (change.ChangeType == "renamed" || change.ChangeType == "moved") {
		name = change.EntityName
	}
	if name == "" {
		return 0
	}
	others := 0
	for fileIndex := range touchedBy[name] {
		if fileIndex != index {
			others++
		}
	}
	review.Signals.RenameRipples += others
	return others
}

func moduleOnly(changes []SemanticChange) bool {
	if len(changes) == 0 {
		return false
	}
	for _, change := range changes {
		if change.EntityType != "orphan" {
			return false
		}
	}
	return true
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func isNonSource(kinds []string) bool {
	return contains(kinds, KindTest) || contains(kinds, KindDocs) || contains(kinds, KindGenerated)
}

func kindFactor(kinds []string) float64 {
	factor := 1.0
	for _, kind := range kinds {
		switch kind {
		case KindGenerated:
			return 0
		case KindDocs:
			factor = math.Min(factor, 0.1)
		case KindTest:
			factor = math.Min(factor, 0.35)
		}
	}
	return factor
}

func statusFactor(status string) float64 {
	switch status {
	case "removed":
		return 1.3
	case "added":
		return 0.9
	default:
		return 1
	}
}

// contentSimilarity is the share of runes the two bodies share as a common
// prefix and suffix. It is deliberately cheap: rewrite detection only needs to
// separate a focused edit from a wholesale replacement.
func contentSimilarity(a, b string) float64 {
	ar, br := []rune(a), []rune(b)
	limit := len(ar)
	if len(br) < limit {
		limit = len(br)
	}
	common := 0
	for common < limit && ar[common] == br[common] {
		common++
	}
	suffix := 0
	for suffix < limit-common && ar[len(ar)-1-suffix] == br[len(br)-1-suffix] {
		suffix++
	}
	longest := len(ar)
	if len(br) > longest {
		longest = len(br)
	}
	if longest == 0 {
		return 1
	}
	return float64(common+suffix) / float64(longest)
}
