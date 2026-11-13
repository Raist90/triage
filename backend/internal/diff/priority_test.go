package diff

import "testing"

func TestKinds(t *testing.T) {
	cases := []struct {
		path string
		want []string
	}{
		{"src/features/prs/DiffView.tsx", nil},
		{"src/features/prs/diffFile.test.ts", []string{KindTest}},
		{"backend/internal/diff/diff_test.go", []string{KindTest}},
		{"e2e/review.spec.ts", []string{KindTest}},
		{"docs/guide.md", []string{KindDocs}},
		{"README.md", []string{KindDocs}},
		{"bun.lock", []string{KindGenerated}},
		{"bun.lockb", []string{KindGenerated}},
		{"dist/app.min.js", []string{KindGenerated}},
		{"node_modules/pkg/index.js", []string{KindGenerated}},
		{"web/__snapshots__/row.snap", []string{KindTest}},
	}
	for _, tc := range cases {
		got := Kinds(tc.path)
		if len(got) != len(tc.want) {
			t.Fatalf("Kinds(%q) = %v, want %v", tc.path, got, tc.want)
		}
		for index := range got {
			if got[index] != tc.want[index] {
				t.Fatalf("Kinds(%q) = %v, want %v", tc.path, got, tc.want)
			}
		}
	}
}

func TestPrioritizeRanksSourceOverDocs(t *testing.T) {
	files := []File{
		{
			Path:  "src/server.go",
			Kinds: []string{},
			Semantic: []SemanticChange{
				{
					ChangeType: "deleted", EntityType: "function", EntityName: "Handle",
					StartLine: 10, EndLine: 70,
				},
				{
					ChangeType: "deleted", EntityType: "function", EntityName: "Close",
					StartLine: 80, EndLine: 90,
				},
			},
		},
		{
			Path:  "docs/guide.md",
			Kinds: []string{KindDocs},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "heading", EntityName: "Usage",
				StartLine: 1, EndLine: 40,
			}},
		},
	}

	Prioritize(files)

	if files[0].Review == nil || files[0].Review.Score <= files[1].Review.Score {
		t.Fatalf("source score %+v should beat docs score %+v", files[0].Review, files[1].Review)
	}
	if files[0].Review.Band != bandHigh {
		t.Fatalf("deleted 60-line function band = %q, want high (score %d)", files[0].Review.Band, files[0].Review.Score)
	}
	if files[0].Review.Signals.Deletes != 2 {
		t.Fatalf("deletes = %d, want 2", files[0].Review.Signals.Deletes)
	}
	if files[1].Review.Band != bandLow {
		t.Fatalf("docs band = %q, want low", files[1].Review.Band)
	}
	if files[1].Review.Score >= 10 {
		t.Fatalf("docs score = %d, want < 10", files[1].Review.Score)
	}
}

func TestPrioritizeGeneratedScoresZero(t *testing.T) {
	files := []File{{
		Path:  "yarn.lock",
		Kinds: []string{KindGenerated},
		Semantic: []SemanticChange{{
			ChangeType: "modified", EntityType: "orphan", EntityName: "module-level",
			StartLine: 1, EndLine: 900,
		}},
	}}
	Prioritize(files)
	if files[0].Review.Score != 0 || files[0].Review.Band != bandLow {
		t.Fatalf("generated review = %+v, want zero/low", files[0].Review)
	}
}

func TestPrioritizeCosmeticOnly(t *testing.T) {
	files := []File{{
		Path:  "src/render.ts",
		Kinds: []string{},
		Semantic: []SemanticChange{
			{ChangeType: "modified", EntityType: "function", EntityName: "render", StartLine: 1, EndLine: 20, Cosmetic: true},
			{ChangeType: "modified", EntityType: "function", EntityName: "draw", StartLine: 30, EndLine: 40, Cosmetic: true},
		},
	}}
	Prioritize(files)
	if !files[0].Review.Signals.CosmeticOnly {
		t.Fatal("CosmeticOnly = false, want true")
	}
	if files[0].Review.Score != 0 {
		t.Fatalf("score = %d, want 0", files[0].Review.Score)
	}
	if files[0].Review.Changes.Cosmetic != 2 {
		t.Fatalf("cosmetic count = %d, want 2", files[0].Review.Changes.Cosmetic)
	}
}

func TestPrioritizeModuleOnly(t *testing.T) {
	files := []File{{
		Path:  "src/index.ts",
		Kinds: []string{},
		Semantic: []SemanticChange{{
			ChangeType: "modified", EntityType: "orphan", EntityName: "module-level",
			StartLine: 1, EndLine: 12,
		}},
	}}
	Prioritize(files)
	if !files[0].Review.Signals.ModuleOnly {
		t.Fatal("ModuleOnly = false, want true")
	}
}

func TestPrioritizeRewrite(t *testing.T) {
	rewrite := File{
		Path:  "src/rewrite.go",
		Kinds: []string{},
		Semantic: []SemanticChange{{
			ChangeType: "modified", EntityType: "function", EntityName: "Run",
			StartLine: 1, EndLine: 20,
			before: "func Run() { old() }",
			after:  "type Replacement struct { value int }",
		}},
	}
	edit := File{
		Path:  "src/edit.go",
		Kinds: []string{},
		Semantic: []SemanticChange{{
			ChangeType: "modified", EntityType: "function", EntityName: "Run",
			StartLine: 1, EndLine: 20,
			before: "func Run() { old() }",
			after:  "func Run() { old(); next() }",
		}},
	}
	files := []File{rewrite, edit}
	Prioritize(files)
	if files[0].Review.Signals.Rewrites != 1 {
		t.Fatalf("rewrite signal = %d, want 1", files[0].Review.Signals.Rewrites)
	}
	if files[1].Review.Signals.Rewrites != 0 {
		t.Fatalf("edit rewrite signal = %d, want 0", files[1].Review.Signals.Rewrites)
	}
	if files[0].Review.Score <= files[1].Review.Score {
		t.Fatalf("rewrite score %d should beat focused edit %d", files[0].Review.Score, files[1].Review.Score)
	}
}

func TestPrioritizeRenameRipples(t *testing.T) {
	files := []File{
		{
			Path:  "src/a.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "renamed", EntityType: "type", EntityName: "Widget",
				OldEntityName: "Thing", StartLine: 1, EndLine: 8,
			}},
		},
		{
			Path:  "src/b.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "function", EntityName: "Thing",
				StartLine: 1, EndLine: 8,
			}},
		},
	}
	Prioritize(files)
	if files[0].Review.Signals.RenameRipples != 1 {
		t.Fatalf("rename ripples = %d, want 1", files[0].Review.Signals.RenameRipples)
	}
}

func TestPrioritizeNoTestChange(t *testing.T) {
	withoutTests := []File{{
		Path:  "src/logic.go",
		Kinds: []string{},
		Semantic: []SemanticChange{{
			ChangeType: "modified", EntityType: "function", EntityName: "Run",
			StartLine: 1, EndLine: 10,
		}},
	}}
	Prioritize(withoutTests)
	if !withoutTests[0].Review.Signals.NoTestChange {
		t.Fatal("NoTestChange = false, want true when the PR has no test files")
	}

	withTests := []File{
		{
			Path:  "src/logic.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "function", EntityName: "Run",
				StartLine: 1, EndLine: 10,
			}},
		},
		{Path: "src/logic_test.go", Kinds: []string{KindTest}},
	}
	Prioritize(withTests)
	if withTests[0].Review.Signals.NoTestChange {
		t.Fatal("NoTestChange = true, want false when a test file changed")
	}
}

func TestPrioritizeFallbackWithoutSemantic(t *testing.T) {
	files := []File{
		{Path: "src/big.go", Kinds: []string{}, Additions: 120, Deletions: 40},
		{Path: "src/tiny.go", Kinds: []string{}, Additions: 2, Deletions: 1},
		{Path: "README.md", Kinds: []string{KindDocs}, Additions: 120, Deletions: 40},
		{Path: "bun.lock", Kinds: []string{KindGenerated}, Additions: 120, Deletions: 40},
	}
	Prioritize(files)
	if files[0].Review.Score <= files[1].Review.Score {
		t.Fatalf("big score %d should beat tiny score %d", files[0].Review.Score, files[1].Review.Score)
	}
	if files[1].Review.Score >= 20 {
		t.Fatalf("tiny score = %d, want low band", files[1].Review.Score)
	}
	if files[2].Review.Score >= files[0].Review.Score {
		t.Fatalf("docs score %d should stay under source %d", files[2].Review.Score, files[0].Review.Score)
	}
	if files[3].Review.Score != 0 {
		t.Fatalf("generated fallback score = %d, want 0", files[3].Review.Score)
	}
}

func TestCanRetainContent(t *testing.T) {
	if canRetainContent("modified", "", "after", 0) {
		t.Fatal("missing before content should not be retained")
	}
	if canRetainContent("added", "before", "after", 0) {
		t.Fatal("added entities have nothing to compare")
	}
	if !canRetainContent("modified", "a", "b", 0) {
		t.Fatal("small modified entity should be retained")
	}
	big := string(make([]byte, maxSemanticEntityBytes))
	if canRetainContent("modified", big, big, 0) {
		t.Fatal("oversized entity should not be retained")
	}
	if canRetainContent("modified", "a", "b", maxSemanticContent) {
		t.Fatal("over-budget content should not be retained")
	}
}

func TestParseSemanticReportRetainsContent(t *testing.T) {
	report, err := parseSemanticReport([]byte(`{"summary":{"total":1},"changes":[
		{"filePath":"a.go","entityType":"function","entityName":"Run","changeType":"modified",
		 "startLine":1,"endLine":9,"beforeContent":"old","afterContent":"new","structuralChange":true}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	change := report.Changes["a.go"][0]
	if change.before != "old" || change.after != "new" {
		t.Fatalf("retained content = %q/%q, want old/new", change.before, change.after)
	}
}
