package review

import (
	"strings"

	"github.com/Raist90/triage/backend/internal/diff"
)

// Sides a GitHub review comment can anchor to.
const (
	CommentSideRight = "RIGHT"
	CommentSideLeft  = "LEFT"
)

// CommentTarget resolves the diff side a finding's line lives on. The added
// side wins when the number exists on both, matching grounding and the
// webview's anchor rule. False means the line is not in any hunk.
func CommentTarget(files []diff.File, finding Finding) (string, bool) {
	if finding.Line <= 0 {
		return "", false
	}
	ground, ok := buildGroundIndex(files).files[normalizeFindingPath(finding.File)]
	if !ok {
		return "", false
	}
	if _, ok := ground.NewLines[finding.Line]; ok {
		return CommentSideRight, true
	}
	if _, ok := ground.OldLines[finding.Line]; ok {
		return CommentSideLeft, true
	}
	return "", false
}

// CommentBody renders one finding as a GitHub review comment. The patch goes in
// a diff fence rather than a suggestion block: a hunk is not a one-click
// suggestion for an exact line range, and posting a suggestion that does not
// match would be worse than a patch the author can read.
func CommentBody(finding Finding) string {
	var body strings.Builder
	title := strings.TrimSpace(finding.Title)
	switch {
	case title != "" && finding.Severity != "":
		body.WriteString("**[" + string(finding.Severity) + "] " + title + "**\n\n")
	case title != "":
		body.WriteString("**" + title + "**\n\n")
	}
	if claim := strings.TrimSpace(finding.Claim); claim != "" {
		body.WriteString(claim)
		body.WriteString("\n\n")
	}
	if suggestion := strings.TrimSpace(finding.Suggestion); suggestion != "" {
		body.WriteString(suggestion)
		body.WriteString("\n\n")
	}
	if patch := strings.TrimSpace(finding.Patch); patch != "" {
		body.WriteString("```diff\n")
		body.WriteString(patch)
		body.WriteString("\n```\n")
	}
	return strings.TrimSpace(body.String())
}
