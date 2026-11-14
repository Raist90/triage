package diff

import (
	"strconv"
	"testing"
)

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

func TestComplexityForBroadPRIsHigh(t *testing.T) {
	files := make([]File, 0, 13)
	for index := 0; index < 13; index++ {
		path := "src/file" + strconv.Itoa(index) + ".go"
		files = append(files, File{
			Path:      path,
			Kinds:     []string{},
			Additions: 100,
			Semantic: []SemanticChange{
				{
					ChangeType: "modified", EntityType: "function",
					EntityName: "Run" + strconv.Itoa(index),
					StartLine:  1, EndLine: 40,
				},
				{
					ChangeType: "added", EntityType: "function",
					EntityName: "Helper" + strconv.Itoa(index),
					StartLine:  50, EndLine: 80,
				},
			},
		})
	}
	files[0].Semantic = []SemanticChange{
		{
			ChangeType: "deleted", EntityType: "function", EntityName: "Handle",
			StartLine: 10, EndLine: 80,
		},
		{
			ChangeType: "deleted", EntityType: "function", EntityName: "Close",
			StartLine: 90, EndLine: 150,
		},
		rewriteChange("Run0"),
	}
	Prioritize(files)

	got := ComplexityFor(files)
	if got == nil {
		t.Fatal("complexity = nil, want a score")
	}
	if got.Band != bandHigh {
		t.Fatalf("band = %q, want high (score %d, %+v)", got.Band, got.Score, got)
	}
	if got.SourceFiles != 13 || got.Changes != 27 {
		t.Fatalf("complexity = %+v, want 13 source files and 27 changes", got)
	}
	if got.Deletes != 2 || got.Rewrites != 1 {
		t.Fatalf("complexity = %+v, want 2 deletes and 1 rewrite", got)
	}
}

// A six-file PR with 17 changes and six rewrites is real work, but it should
// read medium. The shipped formula scored this shape as high 77.
func TestComplexityForTypicalPRIsMedium(t *testing.T) {
	files := []File{
		{
			Path: "src/a.go", Kinds: []string{}, Additions: 20,
			Semantic: []SemanticChange{
				{ChangeType: "deleted", EntityType: "function", EntityName: "Old", StartLine: 1, EndLine: 20},
				{ChangeType: "deleted", EntityType: "function", EntityName: "Legacy", StartLine: 30, EndLine: 50},
				rewriteChange("Load"),
				rewriteChange("Save"),
			},
		},
		{
			Path: "src/b.go", Kinds: []string{}, Additions: 18,
			Semantic: []SemanticChange{
				rewriteChange("Fetch"),
				rewriteChange("Store"),
				rewriteChange("Sync"),
			},
		},
		{
			Path: "src/c.go", Kinds: []string{}, Additions: 16,
			Semantic: []SemanticChange{
				rewriteChange("Plan"),
				{ChangeType: "modified", EntityType: "function", EntityName: "Apply", StartLine: 10, EndLine: 30},
			},
		},
		{
			Path: "src/d.go", Kinds: []string{}, Additions: 20,
			Semantic: []SemanticChange{
				{ChangeType: "modified", EntityType: "function", EntityName: "Read", StartLine: 1, EndLine: 15},
				{ChangeType: "modified", EntityType: "function", EntityName: "Write", StartLine: 20, EndLine: 35},
				{ChangeType: "modified", EntityType: "function", EntityName: "Close", StartLine: 40, EndLine: 55},
			},
		},
		{
			Path: "src/e.go", Kinds: []string{}, Additions: 18,
			Semantic: []SemanticChange{
				{ChangeType: "modified", EntityType: "function", EntityName: "Open", StartLine: 1, EndLine: 15},
				{ChangeType: "modified", EntityType: "function", EntityName: "Seek", StartLine: 20, EndLine: 35},
				{ChangeType: "modified", EntityType: "function", EntityName: "Tell", StartLine: 40, EndLine: 55},
			},
		},
		{
			Path: "src/f.go", Kinds: []string{}, Additions: 14,
			Semantic: []SemanticChange{
				{ChangeType: "added", EntityType: "function", EntityName: "New", StartLine: 1, EndLine: 10},
				{ChangeType: "added", EntityType: "function", EntityName: "Wrap", StartLine: 20, EndLine: 30},
			},
		},
	}
	Prioritize(files)

	got := ComplexityFor(files)
	if got == nil {
		t.Fatal("complexity = nil, want a score")
	}
	if got.Band != bandMedium {
		t.Fatalf("band = %q, want medium (score %d, %+v)", got.Band, got.Score, got)
	}
	if got.Score != 35 {
		t.Fatalf("score = %d, want the calibrated 35 (%+v)", got.Score, got)
	}
	if got.SourceFiles != 6 || got.Changes != 17 {
		t.Fatalf("complexity = %+v, want 6 source files and 17 changes", got)
	}
	if got.Deletes != 2 || got.Rewrites != 6 {
		t.Fatalf("complexity = %+v, want 2 deletes and 6 rewrites", got)
	}
}

func rewriteChange(name string) SemanticChange {
	return SemanticChange{
		ChangeType: "modified", EntityType: "function", EntityName: name,
		StartLine: 1, EndLine: 20,
		before: "func old() { legacy() }",
		after:  "type Replacement struct { value int }",
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
