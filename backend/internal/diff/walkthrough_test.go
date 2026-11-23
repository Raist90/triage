package diff

import (
	"strings"
	"testing"
)

func walkthroughFile(path string, kinds []string, change SemanticChange) File {
	patch := "--- a/" + path + "\n+++ b/" + path + "\n@@ -1,2 +1,3 @@\n context\n-old line\n+new line\n+added line\n"
	file := File{
		Path:     path,
		Kinds:    kinds,
		Patch:    patch,
		Hunks:    BuildHunksFor(path, patch),
		Semantic: []SemanticChange{change},
	}
	for _, hunk := range file.Hunks {
		added, deleted := hunkStats(hunk)
		file.Additions += added
		file.Deletions += deleted
	}
	return file
}

func changed(name string) SemanticChange {
	return SemanticChange{
		ChangeType: "modified", EntityType: "function", EntityName: name,
		StartLine: 1, EndLine: 3, OldStartLine: 1, OldEndLine: 2,
		before: "context\nold line", after: "context\nnew line",
	}
}

// assertCoverage fails when a hunk appears twice or not at all.
func assertCoverage(t *testing.T, files []File, walkthrough *Walkthrough) {
	t.Helper()
	seen := make(map[[2]int]int)
	for _, step := range walkthrough.Steps {
		for _, file := range step.Files {
			index := -1
			for candidate := range files {
				if files[candidate].Path == file.Path {
					index = candidate
					break
				}
			}
			if index < 0 {
				t.Fatalf("step %q names unknown file %q", step.Title, file.Path)
			}
			for _, hunk := range file.Hunks {
				if hunk < 0 || hunk >= len(files[index].Hunks) {
					t.Fatalf("step %q hunk %d out of range for %s", step.Title, hunk, file.Path)
				}
				seen[[2]int{index, hunk}]++
			}
		}
	}
	for index, file := range files {
		if len(file.Hunks) == 0 {
			continue
		}
		for hunk := range file.Hunks {
			if seen[[2]int{index, hunk}] != 1 {
				t.Fatalf("%s hunk %d appears %d times, want exactly once", file.Path, hunk, seen[[2]int{index, hunk}])
			}
		}
	}
}

func TestBuildWalkthroughCoversEveryHunkOnce(t *testing.T) {
	files := []File{
		walkthroughFile("src/a.go", nil, changed("Alpha")),
		walkthroughFile("src/a_test.go", []string{KindTest}, changed("TestAlpha")),
		walkthroughFile("docs/guide.md", []string{KindDocs}, changed("Usage")),
	}
	Prioritize(files)

	walkthrough := BuildWalkthrough(files)
	if walkthrough == nil || len(walkthrough.Steps) == 0 {
		t.Fatal("walkthrough is empty")
	}
	assertCoverage(t, files, walkthrough)

	if got := walkthrough.Steps[len(walkthrough.Steps)-1].Title; got != "Mechanical changes" {
		t.Fatalf("last step = %q, want mechanical changes", got)
	}
	var tests int
	for _, step := range walkthrough.Steps {
		if strings.HasPrefix(step.Title, "Update tests") {
			tests++
		}
	}
	if tests != 1 {
		t.Fatalf("test steps = %d, want 1", tests)
	}
}

func TestBuildWalkthroughGroupsRename(t *testing.T) {
	file := walkthroughFile("src/a.go", nil, SemanticChange{
		ChangeType: "renamed", EntityType: "function",
		EntityName: "renamed", OldEntityName: "helper",
		StartLine: 1, EndLine: 3, OldStartLine: 1, OldEndLine: 2,
	})
	files := []File{file}

	walkthrough := BuildWalkthrough(files)
	assertCoverage(t, files, walkthrough)
	if len(walkthrough.Steps) != 1 {
		t.Fatalf("steps = %d, want 1: %+v", len(walkthrough.Steps), walkthrough.Steps)
	}
	step := walkthrough.Steps[0]
	if step.Title != "Rename helper to renamed" {
		t.Fatalf("title = %q", step.Title)
	}
	if len(step.Files[0].Hunks) != 1 || step.Files[0].Hunks[0] != 0 {
		t.Fatalf("hunks = %v, want the only hunk", step.Files[0].Hunks)
	}
}

func TestBuildWalkthroughPairsCrossFileMove(t *testing.T) {
	deleted := walkthroughFile("src/a.go", nil, SemanticChange{
		ChangeType: "deleted", EntityType: "function", EntityName: "helper",
		StartLine: 1, EndLine: 2, OldStartLine: 1, OldEndLine: 2,
		before: "def helper():\n    return 1",
	})
	added := walkthroughFile("src/b.go", nil, SemanticChange{
		ChangeType: "added", EntityType: "function", EntityName: "helper",
		StartLine: 1, EndLine: 2,
		after: "def helper():\n    return 1",
	})
	files := []File{deleted, added}

	walkthrough := BuildWalkthrough(files)
	assertCoverage(t, files, walkthrough)
	if len(walkthrough.Steps) != 1 {
		t.Fatalf("steps = %d, want one move step: %+v", len(walkthrough.Steps), walkthrough.Steps)
	}
	step := walkthrough.Steps[0]
	if step.Title != "Move helper to b.go" {
		t.Fatalf("title = %q", step.Title)
	}
	if len(step.Files) != 2 || step.Files[0].Path != "src/a.go" || step.Files[1].Path != "src/b.go" {
		t.Fatalf("files = %+v", step.Files)
	}
}

func TestBuildWalkthroughOrdersSourceByFocus(t *testing.T) {
	low := walkthroughFile("src/low.go", nil, changed("Low"))
	high := walkthroughFile("src/high.go", nil, changed("High"))
	low.Review = &FileReview{Score: 10, Band: bandLow}
	high.Review = &FileReview{Score: 80, Band: bandHigh}
	files := []File{low, high}

	walkthrough := BuildWalkthrough(files)
	if len(walkthrough.Steps) != 2 {
		t.Fatalf("steps = %d, want 2", len(walkthrough.Steps))
	}
	if walkthrough.Steps[0].Files[0].Path != "src/high.go" {
		t.Fatalf("first step = %+v, want high focus file", walkthrough.Steps[0])
	}
}

func TestBuildWalkthroughKeepsLongStepTitles(t *testing.T) {
	name := strings.Repeat("wide", 40)
	files := []File{walkthroughFile("src/a.go", nil, changed(name))}

	walkthrough := BuildWalkthrough(files)
	if got, want := walkthrough.Steps[0].Title, "Change "+name; got != want {
		t.Fatalf("title = %q, want the untruncated title", got)
	}
}

func TestBuildWalkthroughCapsSourceSteps(t *testing.T) {
	files := make([]File, 0, 12)
	for index := range 12 {
		files = append(files, walkthroughFile("src/file"+string(rune('a'+index))+".go", nil, changed("Entity")))
	}
	Prioritize(files)

	walkthrough := BuildWalkthrough(files)
	if len(walkthrough.Steps) > walkthroughMaxSourceSteps {
		t.Fatalf("steps = %d, want at most %d", len(walkthrough.Steps), walkthroughMaxSourceSteps)
	}
	if got := walkthrough.Steps[len(walkthrough.Steps)-1].Title; got != "Other source changes" {
		t.Fatalf("last step = %q, want other source changes", got)
	}
	assertCoverage(t, files, walkthrough)
}

func TestBuildWalkthroughSkipsEmptyDiff(t *testing.T) {
	if got := BuildWalkthrough(nil); got != nil {
		t.Fatalf("walkthrough = %+v, want nil", got)
	}
}
