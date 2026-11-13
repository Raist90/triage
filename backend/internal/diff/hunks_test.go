package diff

import (
	"strings"
	"testing"
)

func TestBuildHunksNumbersAndSection(t *testing.T) {
	patch := `diff --git a/main.go b/main.go
index 1111111..2222222 100644
--- a/main.go
+++ b/main.go
@@ -1,3 +1,4 @@ func main() {
 package main
-func main() {}
+func main() { run() }
+// added
\ No newline at end of file
`
	hunks := BuildHunks(patch)
	if len(hunks) != 1 {
		t.Fatalf("got %d hunks, want 1", len(hunks))
	}
	hunk := hunks[0]
	if hunk.Section != "func main() {" || hunk.OldStart != 1 || hunk.NewStart != 1 ||
		hunk.OldCount != 3 || hunk.NewCount != 4 {
		t.Fatalf("hunk = %+v", hunk)
	}
	if len(hunk.Lines) != 4 {
		t.Fatalf("got %d lines, want 4: %+v", len(hunk.Lines), hunk.Lines)
	}

	context, del, add, comment := hunk.Lines[0], hunk.Lines[1], hunk.Lines[2], hunk.Lines[3]
	if context.Kind != "context" || context.OldNumber != 1 || context.NewNumber != 1 {
		t.Errorf("context = %+v", context)
	}
	if del.Kind != "del" || del.OldNumber != 2 || del.NewNumber != 0 || del.Text != "func main() {}" {
		t.Errorf("deletion = %+v", del)
	}
	if add.Kind != "add" || add.OldNumber != 0 || add.NewNumber != 2 {
		t.Errorf("addition = %+v", add)
	}
	if comment.NewNumber != 3 {
		t.Errorf("comment line number = %d, want 3", comment.NewNumber)
	}
}

func TestBuildHunksOmittedCounts(t *testing.T) {
	hunks := BuildHunks("--- a/x\n+++ b/x\n@@ -5 +5 @@\n-old\n+new\n")
	if len(hunks) != 1 || hunks[0].OldCount != 1 || hunks[0].NewCount != 1 {
		t.Fatalf("hunks = %+v", hunks)
	}
	if hunks[0].Lines[0].OldNumber != 5 || hunks[0].Lines[1].NewNumber != 5 {
		t.Errorf("line numbers = %+v", hunks[0].Lines)
	}
}

func TestBuildHunksContentThatLooksLikeHeaders(t *testing.T) {
	hunks := BuildHunks("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n--- removed\n+++ added\n")
	if len(hunks) != 1 || len(hunks[0].Lines) != 2 {
		t.Fatalf("hunks = %+v", hunks)
	}
	if hunks[0].Lines[0].Text != "-- removed" || hunks[0].Lines[1].Text != "++ added" {
		t.Errorf("lines = %+v", hunks[0].Lines)
	}
}

func TestBuildHunksMalformed(t *testing.T) {
	if hunks := BuildHunks(""); hunks != nil {
		t.Fatalf("empty patch hunks = %+v", hunks)
	}
	if hunks := BuildHunks("not a patch\n"); hunks != nil {
		t.Fatalf("garbage hunks = %+v", hunks)
	}
}

func TestEmphasisMarksChangedWords(t *testing.T) {
	hunks := BuildHunks("--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n")
	if len(hunks) != 1 {
		t.Fatalf("got %d hunks", len(hunks))
	}
	del, add := hunks[0].Lines[0], hunks[0].Lines[1]
	if got := spansText(del.Spans); got != "const a = 1;" {
		t.Errorf("removal spans cover %q, want full line", got)
	}
	if got := spansText(add.Spans); got != "const a = 2;" {
		t.Errorf("addition spans cover %q, want full line", got)
	}
	if got := emphasized(del.Spans); got != "1" {
		t.Errorf("removal emphasis = %q, want %q", got, "1")
	}
	if got := emphasized(add.Spans); got != "2" {
		t.Errorf("addition emphasis = %q, want %q", got, "2")
	}
}

func TestEmphasisMergesAdjacentChangedTokens(t *testing.T) {
	hunks := BuildHunks("--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-text-[13px]\n+text-sm\n")
	del, add := hunks[0].Lines[0], hunks[0].Lines[1]
	if got := emphasized(del.Spans); got != "[13px]" {
		t.Errorf("removal emphasis = %q, want %q", got, "[13px]")
	}
	if got := emphasized(add.Spans); got != "sm" {
		t.Errorf("addition emphasis = %q, want %q", got, "sm")
	}
}

func TestEmphasisSpansReformattedVueLines(t *testing.T) {
	// One removed line reformatted into several added ones is the common Vue
	// diff shape; positional pairing would never compare past the first line.
	patch := "--- a/x.vue\n+++ b/x.vue\n@@ -1,1 +1,5 @@\n" +
		"-  {{ format(tour.departureDate) }} -\n" +
		"+  {{\n" +
		"+    format(getUTCDate(tour.departureDate)),\n" +
		"+  }}\n" +
		"+  -\n"
	hunks := BuildHunksFor("x.vue", patch)
	if len(hunks) != 1 {
		t.Fatalf("got %d hunks", len(hunks))
	}
	var emphasizedText strings.Builder
	for _, line := range hunks[0].Lines {
		emphasizedText.WriteString(emphasized(line.Spans))
	}
	if got := emphasizedText.String(); !strings.Contains(got, "getUTCDate") {
		t.Errorf("reformatted block emphasis = %q, want getUTCDate", got)
	}
}

func TestEmphasisKeepsPositionalPairingForCode(t *testing.T) {
	// The same reformat must not go through block matching for code files:
	// flattened LCS matches tokens across lines and emphasizes noise.
	patch := "--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,5 @@\n" +
		"-  {{ format(tour.departureDate) }} -\n" +
		"+  {{\n" +
		"+    format(getUTCDate(tour.departureDate)),\n" +
		"+  }}\n" +
		"+  -\n"
	hunks := BuildHunksFor("x.ts", patch)
	for _, line := range hunks[0].Lines {
		if strings.Contains(emphasized(line.Spans), "getUTCDate") {
			t.Errorf("code file used block emphasis: %+v", line.Spans)
		}
	}
}

func TestEmphasisSkipsHeavyRewrite(t *testing.T) {
	hunks := BuildHunks("--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-aaaaaaaaaa\n+bbbbbbbbbb\n")
	if hunks[0].Lines[0].Spans != nil || hunks[0].Lines[1].Spans != nil {
		t.Errorf("heavy rewrite kept emphasis: %+v / %+v", hunks[0].Lines[0].Spans, hunks[0].Lines[1].Spans)
	}
}

func TestEmphasisSkipsUnrelatedLines(t *testing.T) {
	hunks := BuildHunks("--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-alpha\n+omega\n")
	if hunks[0].Lines[0].Spans != nil {
		t.Errorf("unrelated removal kept emphasis: %+v", hunks[0].Lines[0].Spans)
	}
}

func spansText(spans []Span) string {
	text := ""
	for _, span := range spans {
		text += span.Text
	}
	return text
}

func emphasized(spans []Span) string {
	text := ""
	for _, span := range spans {
		if span.Emph {
			text += span.Text
		}
	}
	return text
}
