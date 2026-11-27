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

const findingMarkerPrefix = "<!-- triage:finding:"
const findingMarkerSuffix = " -->"

// CommentBody renders one finding as a GitHub review comment: severity and
// title, the claim, and the suggestion. The first line is a hidden marker that
// ties the comment back to the finding, so the diff can render the comment
// instead of the finding once it is published. It never posts a suggestion
// block.
func CommentBody(finding Finding) string {
	var body strings.Builder
	if finding.ID != "" {
		body.WriteString(findingMarkerPrefix)
		body.WriteString(finding.ID)
		body.WriteString(findingMarkerSuffix)
		body.WriteString("\n\n")
	}
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
	return strings.TrimSpace(body.String())
}

// ParseFindingMarker splits the hidden finding marker off a published comment.
// The body is returned unchanged when the comment was not written by Triage or
// the marker was edited away.
func ParseFindingMarker(body string) (findingID, rest string) {
	if !strings.HasPrefix(body, findingMarkerPrefix) {
		return "", body
	}
	tail := body[len(findingMarkerPrefix):]
	end := strings.Index(tail, findingMarkerSuffix)
	if end <= 0 {
		return "", body
	}
	id := tail[:end]
	if id[0] != 'F' {
		return "", body
	}
	for _, char := range id[1:] {
		if char < '0' || char > '9' {
			return "", body
		}
	}
	rest = tail[end+len(findingMarkerSuffix):]
	rest = strings.TrimPrefix(rest, "\n\n")
	rest = strings.TrimPrefix(rest, "\n")
	return id, rest
}
