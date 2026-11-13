package diff

import "math"

// Complexity is a pull-request-level read of how much review surface sem found.
// It is an effort estimate, not a risk score: a broad mechanical rename is
// complex even when every edit is safe. Depth is the hardest single file,
// breadth is how many source files the PR reaches, volume is the entity count,
// and signals are the edits that cost the most to verify.
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
	maxScore := 0

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
		if review.Signals.RenameRipples > complexity.Ripples {
			complexity.Ripples = review.Signals.RenameRipples
		}
		if review.Score > maxScore {
			maxScore = review.Score
		}
	}

	if complexity.SourceFiles == 0 {
		return nil
	}

	breadth := math.Min(1, float64(complexity.SourceFiles)/10)
	volume := math.Min(1, float64(complexity.Changes)/30)
	depth := float64(maxScore) / 100
	signals := math.Min(
		1,
		float64(complexity.Deletes+2*complexity.Rewrites+complexity.Ripples)/8,
	)

	score := int(math.Round(100 * (0.40*depth + 0.25*breadth + 0.20*volume + 0.15*signals)))
	if score > 100 {
		score = 100
	}
	if score < 0 {
		score = 0
	}
	complexity.Score = score
	complexity.Band = bandLow
	switch {
	case score >= 55:
		complexity.Band = bandHigh
	case score >= 20:
		complexity.Band = bandMedium
	}
	return complexity
}
