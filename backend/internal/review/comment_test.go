package review

import (
	"strings"
	"testing"

	"github.com/Raist90/triage/backend/internal/diff"
)

func TestCommentBodyRendersFinding(t *testing.T) {
	body := CommentBody(Finding{
		ID:         "F3",
		Title:      "Skipped commit",
		Severity:   SeverityBlocking,
		Claim:      "The early return skips the commit.",
		Suggestion: "Commit before returning.",
	})

	for _, want := range []string{
		"<!-- triage:finding:F3 -->",
		"**[blocking] Skipped commit**",
		"The early return skips the commit.",
		"Commit before returning.",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "```") {
		t.Fatalf("body must not carry a patch fence: %q", body)
	}
	if strings.HasSuffix(body, "\n") {
		t.Fatalf("body must not end with a newline: %q", body)
	}

	id, rest := ParseFindingMarker(body)
	if id != "F3" {
		t.Fatalf("finding id = %q, want F3", id)
	}
	if strings.Contains(rest, "triage:finding") {
		t.Fatalf("marker survived parsing: %q", rest)
	}
	if !strings.HasPrefix(rest, "**[blocking]") {
		t.Fatalf("rest = %q", rest)
	}
}

func TestParseFindingMarkerIgnoresForeignBodies(t *testing.T) {
	for _, body := range []string{
		"**[nit] Title**\n\nNo marker.",
		"<!-- triage:finding: -->\n\nEmpty id.",
		"<!-- triage:finding:F1x -->\n\nBad id.",
		"<!-- triage:finding:F1\n\nNo close.",
	} {
		id, rest := ParseFindingMarker(body)
		if id != "" || rest != body {
			t.Fatalf("body %q parsed as %q/%q", body, id, rest)
		}
	}
}

func TestCommentBodyWithoutSuggestion(t *testing.T) {
	body := CommentBody(Finding{Title: "Nit", Severity: SeverityNitpick, Claim: "Rename it."})
	if !strings.HasPrefix(body, "**[nitpick] Nit**\n\nRename it.") {
		t.Fatalf("body = %q", body)
	}
}

func TestCommentTargetPicksTheChangedSide(t *testing.T) {
	added := diff.File{
		Path:  "src/added.go",
		Hunks: diff.BuildHunksFor("src/added.go", "--- a/src/added.go\n+++ b/src/added.go\n@@ -1 +1 @@\n-old\n+new\n"),
	}
	removed := diff.File{
		Path:  "src/removed.go",
		Hunks: diff.BuildHunksFor("src/removed.go", "--- a/src/removed.go\n+++ b/src/removed.go\n@@ -3 +2,0 @@\n-gone\n"),
	}
	files := []diff.File{added, removed}

	if side, ok := CommentTarget(files, Finding{File: "src/added.go", Line: 1}); !ok || side != CommentSideRight {
		t.Fatalf("added line side = %q/%v, want RIGHT", side, ok)
	}
	if side, ok := CommentTarget(files, Finding{File: "src/removed.go", Line: 3}); !ok || side != CommentSideLeft {
		t.Fatalf("removed line side = %q/%v, want LEFT", side, ok)
	}
	if _, ok := CommentTarget(files, Finding{File: "src/added.go", Line: 2}); ok {
		t.Fatal("a line outside every changed hunk must not be a comment target")
	}
	if _, ok := CommentTarget(files, Finding{File: "src/other.go", Line: 1}); ok {
		t.Fatal("a file the diff does not change must not be a comment target")
	}
}
