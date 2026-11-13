package diff

import "math"

const (
	complexityHigh   = 65
	complexityMedium = 30
)

// Complexity is a pull-request-level read of how much review surface sem found.
// It is an effort estimate, not a risk score: a broad mechanical rename is
// complex even when every edit is safe. The score is built from counts and
// lines rather than the per-file focus score, because focus saturates at 100
// once a file holds a few entities and would dominate every PR.
type Complexity struct {
	Score       int    `json:"score"`
	Band        string `json:"band"`
	SourceFiles int    `json:"sourceFiles"`
	Changes     int    `json:"changes"`
	Deletes     int    `json:"deletes"`
	Rewrites    int    `json:"rewrites"`
	Ripples     int    `json:"ripples,omitempty"`
}

// ComplexityFor rolls per-file reviews up into one score. Tests, docs,
// generated files and cosmetic-only files are excluded so the number tracks
// source review effort, not churn. It returns nil when no source file carries
// a semantic change, which keeps the UI quiet for docs-only diffs.
func ComplexityFor(files []File) *Complexity {
	complexity := &Complexity{}
	lines := 0

	for _, file := range files {
		review := file.Review
		if review == nil || isNonSource(file.Kinds) || review.Signals.CosmeticOnly {
			continue
		}
		changes := review.Changes.Added + review.Changes.Modified +
			review.Changes.Deleted + review.Changes.Moved
		if changes == 0 {
			continue
		}

		complexity.SourceFiles++
		complexity.Changes += changes
		complexity.Deletes += review.Signals.Deletes
		complexity.Rewrites += review.Signals.Rewrites
		lines += file.Additions + file.Deletions
		if review.Signals.RenameRipples > complexity.Ripples {
			complexity.Ripples = review.Signals.RenameRipples
		}
	}

	if complexity.SourceFiles == 0 {
		return nil
	}

	// Breadth is how many source files the PR reaches, volume is the entity
	// count, size is the raw diff lines in those files, and signals are the
	// edits that cost the most to verify. All four saturate, so a giant PR
	// cannot push the number arbitrarily high.
	breadth := math.Min(1, float64(complexity.SourceFiles)/15)
	volume := math.Min(1, float64(complexity.Changes)/50)
	size := math.Min(1, float64(lines)/1200)
	signals := math.Min(
		1,
		float64(complexity.Deletes+2*complexity.Rewrites+complexity.Ripples)/24,
	)

	score := int(math.Round(100 * (0.35*breadth + 0.30*volume + 0.20*size + 0.15*signals)))
	if score > 100 {
		score = 100
	}
	if score < 0 {
		score = 0
	}
	complexity.Score = score
	complexity.Band = bandLow
	switch {
	case score >= complexityHigh:
		complexity.Band = bandHigh
	case score >= complexityMedium:
		complexity.Band = bandMedium
	}
	return complexity
}
