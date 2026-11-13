package omnidiff

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

const escape = "\x1b"

func TestParseSplitsSidesAndPaintsSpans(t *testing.T) {
	raw := "=== before: add.py ===\n" +
		escape + "[90m 1 " + escape + "[0m def total():\n" +
		escape + "[90m 2 " + escape + "[0m " + escape + "[33m~" + escape + "[0m     return " + escape + "[33mresult" + escape + "[0m\n" +
		"=== after: add.py ===\n" +
		escape + "[90m 1 " + escape + "[0m def total():\n" +
		escape + "[90m 2 " + escape + "[0m " + escape + "[33m~" + escape + "[0m     return " + escape + "[32msum(numbers)" + escape + "[0m\n"

	result := Parse([]byte(raw))
	if len(result.Sections) != 2 {
		t.Fatalf("sections = %d, want 2", len(result.Sections))
	}
	if result.Sections[0].Side != "before" || result.Sections[1].Side != "after" {
		t.Fatalf("sides = %q, %q", result.Sections[0].Side, result.Sections[1].Side)
	}
	if result.Sections[0].Path != "add.py" {
		t.Fatalf("path = %q", result.Sections[0].Path)
	}

	before := result.Sections[0].Lines[1]
	if before.Kind != LineChange {
		t.Fatalf("before line kind = %q, want change", before.Kind)
	}
	if !hasSpan(before, "result", SpanChange) {
		t.Fatalf("before line misses the yellow change span: %+v", before.Spans)
	}

	after := result.Sections[1].Lines[1]
	if !hasSpan(after, "sum(numbers)", SpanAdd) {
		t.Fatalf("after line misses the green add span: %+v", after.Spans)
	}
}

func TestParseClassifiesMarkersAndMeta(t *testing.T) {
	raw := "=== before: gone.js ===\n" +
		escape + "[90m1 " + escape + "[0m keep();\n" +
		escape + "[90m2 " + escape + "[0m " + escape + "[31m-" + escape + "[0m " + escape + "[31m  removed();" + escape + "[0m\n" +
		escape + "[90mMoved to line 2" + escape + "[0m\n" +
		escape + "[90m--------------------" + escape + "[0m\n"

	result := Parse([]byte(raw))
	if len(result.Sections) != 1 {
		t.Fatalf("sections = %d, want 1", len(result.Sections))
	}
	lines := result.Sections[0].Lines
	if lines[0].Kind != LineContext {
		t.Fatalf("line 0 = %q, want context", lines[0].Kind)
	}
	if lines[1].Kind != LineDel {
		t.Fatalf("line 1 = %q, want del", lines[1].Kind)
	}
	if lines[2].Kind != LineMeta || lines[3].Kind != LineMeta {
		t.Fatalf("meta lines = %q, %q", lines[2].Kind, lines[3].Kind)
	}
}

func TestParseKeepsUnknownSequences(t *testing.T) {
	raw := "=== after: x.css ===\n" + escape + "[1;38;5;208mwarn" + escape + "[0m rest\n"
	result := Parse([]byte(raw))
	if len(result.Sections) != 1 {
		t.Fatalf("sections = %d, want 1", len(result.Sections))
	}
	line := result.Sections[0].Lines[0]
	if !hasSpan(line, "warn", SpanChange) {
		t.Fatalf("orange indexed colour should classify as change: %+v", line.Spans)
	}
	if !hasSpan(line, " rest", SpanPlain) {
		t.Fatalf("tail should stay plain: %+v", line.Spans)
	}
}

func TestParseSummaryBeforeSections(t *testing.T) {
	raw := escape + "[1mNew file - everything inserted" + escape + "[0m\n" +
		"=== after: new.go ===\n" +
		escape + "[90m 1 " + escape + "[0m " + escape + "[32m+" + escape + "[0m " + escape + "[32mpackage main" + escape + "[0m\n"

	result := Parse([]byte(raw))
	if len(result.Summary) != 1 || result.Summary[0].Kind != LineSummary {
		t.Fatalf("summary = %+v", result.Summary)
	}
	if len(result.Sections) != 1 || result.Sections[0].Side != "after" {
		t.Fatalf("sections = %+v", result.Sections)
	}
}

// TestRunAgainstInstalledCLI exercises the real binary when it exists. It is
// skipped on machines without omnidiff so the suite stays green everywhere.
func TestRunAgainstInstalledCLI(t *testing.T) {
	if !Available() {
		t.Skip("omnidiff is not installed")
	}
	dir := t.TempDir()
	before := filepath.Join(dir, "before.py")
	after := filepath.Join(dir, "after.py")
	if err := os.WriteFile(before, []byte("def total(xs):\n    return sum(xs)\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(after, []byte("def total(xs):\n    return len(xs)\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := Run(context.Background(), before, after)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(result.Sections) != 2 {
		t.Fatalf("sections = %d, want 2", len(result.Sections))
	}
	// OmniDiff paints a replaced token yellow on the before side and green on
	// the after side; whole deleted lines are the only red ones.
	if !hasAnySpan(result, "sum", SpanChange) {
		t.Fatalf("before side should paint the replaced call: %+v", result.Sections[0].Lines)
	}
	if !hasAnySpan(result, "len", SpanChange) {
		t.Fatalf("after side should paint the replaced call: %+v", result.Sections[1].Lines)
	}
}

func hasAnySpan(result Result, text, kind string) bool {
	for _, section := range result.Sections {
		for _, line := range section.Lines {
			if hasSpan(line, text, kind) {
				return true
			}
		}
	}
	return false
}

func hasSpan(line Line, text, kind string) bool {
	for _, span := range line.Spans {
		if span.Text == text && span.Kind == kind {
			return true
		}
	}
	return false
}
