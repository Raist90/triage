// Package review holds the structured document an automatic review returns.
//
// The types are the contract between the Go runner and the webview. Parsing
// model output and sanitizing it live beside them; nothing here talks to a
// provider.
package review

import "time"

// Severity is how much a finding should hold up the merge.
type Severity string

const (
	SeverityBlocking Severity = "blocking"
	SeverityWarning  Severity = "warning"
	SeverityNitpick  Severity = "nitpick"
	SeverityPraise   Severity = "praise"
)

// Valid reports whether s is one of the known severities.
func (s Severity) Valid() bool {
	switch s {
	case SeverityBlocking, SeverityWarning, SeverityNitpick, SeverityPraise:
		return true
	default:
		return false
	}
}

// Category is what kind of review point a finding makes.
type Category string

const (
	CategoryRisk         Category = "risk"
	CategoryDesign       Category = "design"
	CategoryArchitecture Category = "architecture"
	CategoryConventions  Category = "conventions"
	CategoryTests        Category = "tests"
)

// Valid reports whether c is one of the known categories.
func (c Category) Valid() bool {
	switch c {
	case CategoryRisk, CategoryDesign, CategoryArchitecture, CategoryConventions, CategoryTests:
		return true
	default:
		return false
	}
}

// Verdict is the review's overall call. Overridden marks a verdict the user
// changed by hand.
type Verdict struct {
	SafeToMerge bool   `json:"safeToMerge"`
	Summary     string `json:"summary"`
	Overridden  bool   `json:"overridden,omitempty"`
}

// Finding is one review point anchored to a file and line. Evidence is the
// exact changed line the finding is about, copied by the model; the server
// resolves the line from it instead of trusting a model-supplied number. Patch
// is a suggested unified diff hunk, empty when the finding has no mechanical
// fix.
type Finding struct {
	ID             string     `json:"id"`
	Severity       Severity   `json:"severity" enum:"blocking,warning,nitpick,praise" doc:"How serious the finding is"`
	Category       Category   `json:"category" enum:"risk,design,architecture,conventions,tests" doc:"What kind of problem it is"`
	Title          string     `json:"title"`
	Claim          string     `json:"claim"`
	Suggestion     string     `json:"suggestion,omitempty"`
	File           string     `json:"file"`
	Line           int        `json:"line"`
	EndLine        int        `json:"endLine,omitempty"`
	Entity         string     `json:"entity,omitempty"`
	Evidence       string     `json:"evidence,omitempty"`
	Guideline      string     `json:"guideline,omitempty"`
	GuidelineQuote string     `json:"guidelineQuote,omitempty"`
	Patch          string     `json:"patch,omitempty"`
	Anchored       bool       `json:"anchored"`
	AppliedAt      *time.Time `json:"appliedAt,omitempty"`
}

// DroppedFinding records one finding the server refused to show and why. The
// submitted evidence and guideline quote are included so a drop can be audited
// without rerunning the review.
type DroppedFinding struct {
	Title          string   `json:"title"`
	Severity       Severity `json:"severity" enum:"blocking,warning,nitpick,praise"`
	File           string   `json:"file"`
	Line           int      `json:"line,omitempty"`
	Evidence       string   `json:"evidence,omitempty"`
	Guideline      string   `json:"guideline,omitempty"`
	GuidelineQuote string   `json:"guidelineQuote,omitempty"`
	Reason         string   `json:"reason"`
}

// Review is one review document. Omitted counts findings dropped to stay inside
// the output budget. Unverified counts findings hidden because they did not
// match the changed code. UnverifiedBlocking keeps the verdict conservative
// when one of the hidden findings claimed to block the merge. Dropped carries
// the audit trail for every hidden finding.
type Review struct {
	Verdict            Verdict          `json:"verdict"`
	Findings           []Finding        `json:"findings"`
	Dropped            []DroppedFinding `json:"dropped,omitempty"`
	Omitted            int              `json:"omitted,omitempty"`
	Unverified         int              `json:"unverified,omitempty"`
	UnverifiedBlocking int              `json:"unverifiedBlocking,omitempty"`
}
