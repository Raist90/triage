package diff

import "testing"

func TestHighlightAddsSyntaxKinds(t *testing.T) {
	patch := "--- a/x.go\n+++ b/x.go\n@@ -1,2 +1,2 @@\n package main\n-func run() { x := 1 }\n+func run() { y := \"s\" }\n"
	hunks := BuildHunks(patch)
	if len(hunks) != 1 {
		t.Fatalf("got %d hunks", len(hunks))
	}

	Highlight("x.go", hunks)

	del, add := hunks[0].Lines[1], hunks[0].Lines[2]
	if got := spansText(del.Spans); got != del.Text {
		t.Errorf("highlighted removal covers %q, want %q", got, del.Text)
	}
	if got := spansText(add.Spans); got != add.Text {
		t.Errorf("highlighted addition covers %q, want %q", got, add.Text)
	}
	for _, kind := range []string{KindKeyword, KindNumber} {
		if !hasKind(del.Spans, kind) {
			t.Errorf("removal has no %q span: %+v", kind, del.Spans)
		}
	}
	for _, kind := range []string{KindKeyword, KindString} {
		if !hasKind(add.Spans, kind) {
			t.Errorf("addition has no %q span: %+v", kind, add.Spans)
		}
	}
	if !hasEmph(add.Spans) {
		t.Errorf("syntax merge dropped emphasis: %+v", add.Spans)
	}
}

func TestHighlightAddsWiderTokenKinds(t *testing.T) {
	cases := []struct {
		path string
		line string
		want []string
	}{
		{path: "x.tsx", line: `<Card title="a" />`, want: []string{KindTag, KindProperty, KindString}},
		{path: "x.vue", line: `const msg: string = "hi"`, want: []string{KindKeyword, KindString}},
		{path: "x.vue", line: `<div class="wrap">`, want: []string{KindTag, KindProperty, KindString}},
		{path: "x.swift", line: `let total = count`, want: []string{KindVariable}},
		{path: "x.json", line: `{"on": true}`, want: []string{KindTag, KindBuiltin}},
		{path: "x.go", line: `fmt.Sprintf("x")`, want: []string{KindFunc, KindString}},
	}
	for _, test := range cases {
		patch := "--- a/" + test.path + "\n+++ b/" + test.path +
			"\n@@ -1,1 +1,1 @@\n " + test.line + "\n"
		hunks := BuildHunks(patch)
		if len(hunks) != 1 || len(hunks[0].Lines) != 1 {
			t.Fatalf("%s: got %+v", test.path, hunks)
		}
		Highlight(test.path, hunks)
		spans := hunks[0].Lines[0].Spans
		if got := spansText(spans); got != test.line {
			t.Errorf("%s: highlighted line covers %q, want %q", test.path, got, test.line)
		}
		for _, kind := range test.want {
			if !hasKind(spans, kind) {
				t.Errorf("%s: no %q span: %+v", test.path, kind, spans)
			}
		}
	}
}

func TestHighlightVueHTMLCommentDoesNotStartString(t *testing.T) {
	patch := "--- a/club-card.vue\n+++ b/club-card.vue\n@@ -1,4 +1,6 @@\n <template>\n" +
		"+  <!-- The Club's own \"gold\" colours -->\n" +
		"+  <section class=\"club\">\n" +
		"+    <p>ok</p>\n" +
		"+  </section>\n" +
		" </template>\n"
	hunks := BuildHunks(patch)
	if len(hunks) != 1 || len(hunks[0].Lines) != 6 {
		t.Fatalf("got %+v", hunks)
	}

	Highlight("club-card.vue", hunks)

	comment := hunks[0].Lines[1]
	if !hasKind(comment.Spans, KindComment) {
		t.Errorf("HTML comment is not a comment: %+v", comment.Spans)
	}
	if hasKind(comment.Spans, KindString) {
		t.Errorf("HTML comment leaked into a string: %+v", comment.Spans)
	}

	section := hunks[0].Lines[2]
	for _, kind := range []string{KindTag, KindProperty, KindString} {
		if !hasKind(section.Spans, kind) {
			t.Errorf("section after comment has no %q span: %+v", kind, section.Spans)
		}
	}

	for _, line := range hunks[0].Lines {
		if got := spansText(line.Spans); got != line.Text {
			t.Errorf("highlighted line covers %q, want %q", got, line.Text)
		}
	}
}

func TestHighlightUnknownLanguage(t *testing.T) {
	patch := "--- a/x.zzz\n+++ b/x.zzz\n@@ -1,1 +1,1 @@\n-old\n+new\n"
	hunks := BuildHunks(patch)
	before := hunks[0].Lines[0].Spans
	Highlight("x.zzz", hunks)
	if spansText(hunks[0].Lines[0].Spans) != spansText(before) {
		t.Errorf("unknown language changed spans: %+v", hunks[0].Lines[0].Spans)
	}
}

func TestHighlightSkipsMarkupFiles(t *testing.T) {
	patch := "--- a/App.vue\n+++ b/App.vue\n@@ -1,1 +1,1 @@\n-const msg = 1;\n+const msg = \"hi\";\n"
	for _, path := range []string{"index.html", "App.svelte", "README.md"} {
		hunks := BuildHunks(patch)
		Highlight(path, hunks)
		for _, line := range hunks[0].Lines {
			if hasKind(line.Spans, KindString) || hasKind(line.Spans, KindKeyword) {
				t.Errorf("%s was syntax highlighted: %+v", path, line.Spans)
			}
		}
	}
}

func TestEmphasisShare(t *testing.T) {
	spans := []Span{{Text: "abc", Emph: true}, {Text: "defg"}}
	if got := emphasisShare(spans, "abcdefg"); got < 0.42 || got > 0.44 {
		t.Errorf("emphasisShare = %v, want ~3/7", got)
	}
	if got := emphasisShare(nil, "abc"); got != 0 {
		t.Errorf("empty spans share = %v, want 0", got)
	}
}

func hasKind(spans []Span, kind string) bool {
	for _, span := range spans {
		if span.Kind == kind {
			return true
		}
	}
	return false
}

func hasEmph(spans []Span) bool {
	for _, span := range spans {
		if span.Emph {
			return true
		}
	}
	return false
}
