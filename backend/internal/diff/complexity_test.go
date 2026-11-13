package diff

import "testing"

func TestComplexityForNilWithoutSemantic(t *testing.T) {
	files := []File{{Path: "src/app.go", Kinds: []string{}, Additions: 40, Deletions: 10}}
	Prioritize(files)
	if got := ComplexityFor(files); got != nil {
		t.Fatalf("complexity = %+v, want nil without a semantic report", got)
	}
}

func TestComplexityForSkipsDocsAndGenerated(t *testing.T) {
	files := []File{
		{
			Path:  "README.md",
			Kinds: []string{KindDocs},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "heading", EntityName: "Usage",
				StartLine: 1, EndLine: 40,
			}},
		},
		{
			Path:  "bun.lock",
			Kinds: []string{KindGenerated},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "orphan", EntityName: "module-level",
				StartLine: 1, EndLine: 900,
			}},
		},
		{
			Path:  "src/app_test.go",
			Kinds: []string{KindTest},
			Semantic: []SemanticChange{{
				ChangeType: "added", EntityType: "function", EntityName: "TestApp",
				StartLine: 1, EndLine: 120,
			}},
		},
	}
	Prioritize(files)
	if got := ComplexityFor(files); got != nil {
		t.Fatalf("complexity = %+v, want nil for docs, generated and test files only", got)
	}
}

func TestComplexityForSmallEditIsLow(t *testing.T) {
	files := []File{{
		Path:  "src/app.go",
		Kinds: []string{},
		Semantic: []SemanticChange{{
			ChangeType: "modified", EntityType: "function", EntityName: "Run",
			StartLine: 1, EndLine: 6,
		}},
	}}
	Prioritize(files)

	got := ComplexityFor(files)
	if got == nil {
		t.Fatal("complexity = nil, want a score")
	}
	if got.Band != bandLow {
		t.Fatalf("band = %q, want low (score %d)", got.Band, got.Score)
	}
	if got.SourceFiles != 1 || got.Changes != 1 {
		t.Fatalf("complexity = %+v, want 1 source file and 1 change", got)
	}
}

func TestComplexityForBroadDeletesAndRewriteIsHigh(t *testing.T) {
	files := []File{
		{
			Path:  "src/a.go",
			Kinds: []string{},
			Semantic: []SemanticChange{
				{
					ChangeType: "deleted", EntityType: "function", EntityName: "Handle",
					StartLine: 10, EndLine: 80,
				},
				{
					ChangeType: "deleted", EntityType: "function", EntityName: "Close",
					StartLine: 90, EndLine: 150,
				},
			},
		},
		{
			Path:  "src/b.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "function", EntityName: "Run",
				StartLine: 1, EndLine: 90,
				before: "func Run() { old() }",
				after:  "type Replacement struct { value int }",
			}},
		},
		{
			Path:  "src/c.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "added", EntityType: "function", EntityName: "Retry",
				StartLine: 1, EndLine: 60,
			}},
		},
		{
			Path:  "src/d.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "function", EntityName: "Load",
				StartLine: 1, EndLine: 20,
			}},
		},
		{
			Path:  "src/e.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "function", EntityName: "Save",
				StartLine: 1, EndLine: 20,
			}},
		},
		{
			Path:  "src/f.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "renamed", EntityType: "type", EntityName: "Widget",
				OldEntityName: "Thing", StartLine: 1, EndLine: 8,
			}},
		},
		{
			Path:  "src/g.go",
			Kinds: []string{},
			Semantic: []SemanticChange{{
				ChangeType: "modified", EntityType: "function", EntityName: "Thing",
				StartLine: 1, EndLine: 8,
			}},
		},
	}
	Prioritize(files)

	got := ComplexityFor(files)
	if got == nil {
		t.Fatal("complexity = nil, want a score")
	}
	if got.Band != bandHigh {
		t.Fatalf("band = %q, want high (score %d, %+v)", got.Band, got.Score, got)
	}
	if got.SourceFiles != 7 || got.Changes != 8 {
		t.Fatalf("complexity = %+v, want 7 source files and 8 changes", got)
	}
	if got.Deletes != 2 || got.Rewrites != 1 {
		t.Fatalf("complexity = %+v, want 2 deletes and 1 rewrite", got)
	}
	if got.Ripples != 1 {
		t.Fatalf("complexity = %+v, want 1 rename ripple", got)
	}
}

func TestComplexityForSkipsCosmeticOnlyFiles(t *testing.T) {
	files := []File{{
		Path:  "src/render.ts",
		Kinds: []string{},
		Semantic: []SemanticChange{
			{ChangeType: "modified", EntityType: "function", EntityName: "render", StartLine: 1, EndLine: 20, Cosmetic: true},
			{ChangeType: "modified", EntityType: "function", EntityName: "draw", StartLine: 30, EndLine: 40, Cosmetic: true},
		},
	}}
	Prioritize(files)
	if got := ComplexityFor(files); got != nil {
		t.Fatalf("complexity = %+v, want nil for cosmetic-only files", got)
	}
}
