package review

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/diff"
)

func readFixture(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(data)
}

func fixtureMeta() Meta {
	return Meta{
		Repo:        "Raist90/triage",
		Number:      7,
		Title:       "Retry charges with a fresh idempotency key",
		Branch:      "eng-7-retry",
		BaseBranch:  "main",
		BaseSHA:     "abc1234",
		Description: "The retry path reuses the first idempotency key.",
	}
}

func defaultReviewPrompt(t *testing.T) string {
	t.Helper()
	for _, action := range config.Default().Actions.Items {
		if action.Kind != "review" {
			continue
		}
		if action.Prompt == "" {
			t.Fatal("config.Default review prompt is empty")
		}
		return action.Prompt
	}
	t.Fatal("config.Default has no review action")
	return ""
}

// appendPatchFile writes one valid add-file patch with lines added lines.
func appendPatchFile(b *strings.Builder, path string, lines int) {
	b.WriteString("diff --git a/" + path + " b/" + path + "\n")
	b.WriteString("new file mode 100644\n")
	b.WriteString("--- /dev/null\n")
	b.WriteString("+++ b/" + path + "\n")
	fmt.Fprintf(b, "@@ -0,0 +1,%d @@\n", lines)
	for index := 0; index < lines; index++ {
		fmt.Fprintf(b, "+line %d of %s padding padding padding padding padding\n", index, path)
	}
}

func TestSemanticPathsFixture(t *testing.T) {
	covered := semanticPaths(readFixture(t, "sem.md"))
	if !covered["backend/internal/service/charge.go"] {
		t.Fatalf("nested path missing from coverage: %v", covered)
	}
	if covered["backend/internal/review/ignored.go"] {
		t.Fatal("a heading inside a fenced block was counted as covered")
	}
	if covered["deploy/values.yaml"] {
		t.Fatal("values.yaml is absent from the sem report but counted as covered")
	}
}

func TestSemanticPathsToleratesNoise(t *testing.T) {
	report := "# Report\n\n\n###   `src/nested/thing.go`  \n\ntext\n###\tnot-a-heading.go\n"
	covered := semanticPaths(report)
	if !covered["src/nested/thing.go"] {
		t.Fatalf("expected cleaned nested path, got %v", covered)
	}
	if len(covered) != 1 {
		t.Fatalf("coverage = %v, want one path", covered)
	}
}

func TestSemanticMissingBinary(t *testing.T) {
	// An empty PATH proves the missing-binary path without requiring the real
	// sem binary on the machine.
	t.Setenv("PATH", t.TempDir())
	if _, _, ok := Semantic(context.Background(), t.TempDir(), "aaa", "bbb"); ok {
		t.Fatal("Semantic reported ok without a sem binary")
	}
}

func TestSemanticEmptyInput(t *testing.T) {
	if _, _, ok := Semantic(context.Background(), "", "aaa", "bbb"); ok {
		t.Fatal("Semantic reported ok for an empty dir")
	}
}

func TestSemanticRunsFakeExecutable(t *testing.T) {
	fixture, err := filepath.Abs(filepath.Join("testdata", "sem.md"))
	if err != nil {
		t.Fatalf("abs fixture: %v", err)
	}
	bin := t.TempDir()
	script := fmt.Sprintf("#!/bin/sh\ncat %s\n", fixture)
	if err := os.WriteFile(filepath.Join(bin, "sem"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake sem: %v", err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	markdown, covered, ok := Semantic(context.Background(), t.TempDir(), "abc1234", "def5678")
	if !ok {
		t.Fatal("Semantic failed with a working fake sem")
	}
	if !strings.Contains(markdown, "charge.go") {
		t.Fatalf("markdown missing fixture content: %q", markdown)
	}
	if !covered["backend/internal/service/charge.go"] {
		t.Fatalf("coverage = %v", covered)
	}
}

func TestGuidelinesOrderAndNames(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "AGENTS.md"), "agents rules")
	writeTestFile(t, filepath.Join(dir, "CLAUDE.md"), "claude rules")
	writeTestFile(t, filepath.Join(dir, "CONTRIBUTING.md"), "contributing rules")
	writeTestFile(t, filepath.Join(dir, ".github", "CONTRIBUTING.md"), "github contributing rules")

	got := Guidelines(context.Background(), dir)
	if got == "" {
		t.Fatal("Guidelines returned nothing")
	}
	names := []string{"## AGENTS.md", "## CLAUDE.md", "## CONTRIBUTING.md", "## .github/CONTRIBUTING.md"}
	last := -1
	for _, name := range names {
		index := strings.Index(got, name)
		if index < 0 {
			t.Fatalf("missing section %q in %q", name, got)
		}
		if index <= last {
			t.Fatalf("section %q is out of order in %q", name, got)
		}
		last = index
	}
}

func TestGuidelinesMissingDocs(t *testing.T) {
	if got := Guidelines(context.Background(), t.TempDir()); got != "" {
		t.Fatalf("Guidelines = %q, want empty", got)
	}
}

func TestGuidelinesCap(t *testing.T) {
	dir := t.TempDir()
	var body strings.Builder
	for index := 0; index < 2000; index++ {
		fmt.Fprintf(&body, "guideline line %d with enough characters to be worth reading\n", index)
	}
	writeTestFile(t, filepath.Join(dir, "AGENTS.md"), body.String())

	got := Guidelines(context.Background(), dir)
	if len(got) > maxGuidelinesBytes {
		t.Fatalf("Guidelines = %d bytes, budget %d", len(got), maxGuidelinesBytes)
	}
	if !strings.Contains(got, "… [truncated]") {
		t.Fatalf("Guidelines did not mark truncation: %q", got)
	}
	if !strings.HasPrefix(got, "## AGENTS.md") {
		t.Fatalf("Guidelines lost its section heading: %q", got[:min(40, len(got))])
	}
}

func TestBuildInputMixed(t *testing.T) {
	unified := readFixture(t, "mixed.diff")
	semantic := readFixture(t, "sem.md")
	files := diff.Parse([]byte(unified))
	covered := semanticPaths(semantic)

	in := BuildInput(fixtureMeta(), semantic, covered, "## AGENTS.md\n\nKeep it small.", files, []byte(unified))

	if in.FileCount != 3 {
		t.Fatalf("FileCount = %d, want 3", in.FileCount)
	}
	if !strings.Contains(in.Semantic, "### backend/internal/service/charge.go") {
		t.Fatalf("semantic section missing the Go file: %q", in.Semantic)
	}
	if strings.Contains(in.RawDiff, "diff --git a/backend/internal/service/charge.go") {
		t.Fatal("covered Go file also appears in the raw section")
	}
	if !strings.Contains(in.RawDiff, "diff --git a/deploy/values.yaml") {
		t.Fatal("YAML file missing from the raw section")
	}
	if !strings.Contains(in.RawDiff, "diff --git a/bun.lock") {
		t.Fatal("lockfile missing from the raw section with room to spare")
	}
	if in.DiffNote != "complete" {
		t.Fatalf("DiffNote = %q, want complete", in.DiffNote)
	}
	assertNoDuplicateOrDropped(t, files, in)

	out, err := Render(defaultReviewPrompt(t), in)
	if err != nil {
		t.Fatalf("render default review prompt: %v", err)
	}
	if !strings.Contains(out, "PR #7: Retry charges") {
		t.Fatalf("prompt missing metadata: %q", out)
	}
	for _, section := range []string{"<guidelines>", "<semantic>", "<diff>"} {
		if strings.Count(out, section) != 1 {
			t.Fatalf("prompt must contain %s exactly once", section)
		}
	}
	if !strings.Contains(out, "Return only the JSON object described in the system prompt.") {
		t.Fatalf("prompt missing the closing instruction: %q", out)
	}
}

func TestBuildInputOmitsLockfileLast(t *testing.T) {
	var patch strings.Builder
	appendPatchFile(&patch, "bun.lock", 3)
	appendPatchFile(&patch, "src/a.go", 1000)
	appendPatchFile(&patch, "src/b.go", 1000)
	unified := []byte(patch.String())
	files := diff.Parse(unified)

	in := BuildInput(Meta{}, "", nil, "", files, unified)

	if !strings.Contains(in.RawDiff, "diff --git a/src/a.go") {
		t.Fatal("source file missing from the raw section")
	}
	if strings.Contains(in.RawDiff, "diff --git a/bun.lock") {
		t.Fatal("lockfile took budget from source files")
	}
	if !strings.Contains(in.DiffNote, "omitted or truncated") {
		t.Fatalf("DiffNote = %q, want an omission note", in.DiffNote)
	}
	if len(in.RawDiff) > maxRawBytesNoSem+64 {
		t.Fatalf("RawDiff = %d bytes, budget %d", len(in.RawDiff), maxRawBytesNoSem)
	}
	assertNoDuplicateOrDropped(t, files, in)
}

func TestBuildInputSemUnavailable(t *testing.T) {
	unified := readFixture(t, "mixed.diff")
	files := diff.Parse([]byte(unified))

	in := BuildInput(fixtureMeta(), "", nil, "", files, []byte(unified))

	if in.Semantic != "" {
		t.Fatalf("Semantic = %q, want empty", in.Semantic)
	}
	if in.DiffNote != "sem unavailable, raw diff only" {
		t.Fatalf("DiffNote = %q", in.DiffNote)
	}
	for _, file := range files {
		if !strings.Contains(in.RawDiff, "diff --git a/"+file.Path) {
			t.Fatalf("%s missing from the raw section", file.Path)
		}
	}

	out, err := Render(defaultReviewPrompt(t), in)
	if err != nil {
		t.Fatalf("render without sem: %v", err)
	}
	if !strings.Contains(out, "sem unavailable, raw diff only") {
		t.Fatalf("note missing from prompt: %q", out)
	}
}

func TestBuildInputEmptyDiff(t *testing.T) {
	in := BuildInput(fixtureMeta(), "", nil, "", nil, nil)
	if in.FileCount != 0 || in.FileList != "" || in.DiffNote != "no changes" {
		t.Fatalf("empty diff input = %+v", in)
	}
	if _, err := Render(defaultReviewPrompt(t), in); err != nil {
		t.Fatalf("render empty review prompt: %v", err)
	}
}

func TestBuildInputLargeDiff(t *testing.T) {
	var patch strings.Builder
	appendPatchFile(&patch, "src/a.go", 1700)
	appendPatchFile(&patch, "src/b.go", 1700)
	unified := []byte(patch.String())
	if len(unified) < 200<<10 {
		t.Fatalf("fixture patch is only %d bytes", len(unified))
	}
	files := diff.Parse(unified)

	meta := fixtureMeta()
	meta.Description = strings.Repeat("description line for budget testing\n", 400)
	guidelines := strings.Repeat("## AGENTS.md\n\n"+strings.Repeat("rule line\n", 300), 6)

	in := BuildInput(meta, "", nil, guidelines, files, unified)
	out, err := Render(defaultReviewPrompt(t), in)
	if err != nil {
		t.Fatalf("render large prompt: %v", err)
	}
	if len(out) > 170<<10 {
		t.Fatalf("prompt = %d bytes, budget %d", len(out), 170<<10)
	}
	if len(in.Description) > maxDescriptionBytes {
		t.Fatalf("description = %d bytes", len(in.Description))
	}
	if len(in.Guidelines) > maxGuidelinesBytes {
		t.Fatalf("guidelines = %d bytes", len(in.Guidelines))
	}
}

func TestBuildInputTruncatesSemantic(t *testing.T) {
	var sem strings.Builder
	for index := 0; index < 4000; index++ {
		fmt.Fprintf(&sem, "### src/generated/file%04d.go\n\n- modified\n\n", index)
	}
	if sem.Len() < maxSemanticBytes {
		t.Fatalf("sem fixture is only %d bytes", sem.Len())
	}

	var patch strings.Builder
	appendPatchFile(&patch, "src/one.go", 5)
	unified := []byte(patch.String())
	files := diff.Parse(unified)

	in := BuildInput(Meta{}, sem.String(), semanticPaths(sem.String()), "", files, unified)
	if len(in.Semantic) > maxSemanticBytes+64 {
		t.Fatalf("Semantic = %d bytes, budget %d", len(in.Semantic), maxSemanticBytes)
	}
	if !strings.Contains(in.Semantic, "… [truncated]") {
		t.Fatal("Semantic truncation was not marked")
	}
	if !strings.Contains(in.DiffNote, "omitted or truncated") {
		t.Fatalf("DiffNote = %q, want a count of dropped sem headings", in.DiffNote)
	}
}

func TestRenderFailsOnMissingKey(t *testing.T) {
	if _, err := Render("{{.Missing}}", Input{}); err == nil {
		t.Fatal("Render accepted a missing template key")
	}
	if _, err := Render("{{", Input{}); err == nil {
		t.Fatal("Render accepted a broken template")
	}
}

func TestJSONSchemaIsValidJSON(t *testing.T) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(JSONSchema()), &payload); err != nil {
		t.Fatalf("schema is not valid JSON: %v", err)
	}
	if payload["type"] != "object" {
		t.Fatalf("schema type = %v", payload["type"])
	}
}

// assertNoDuplicateOrDropped checks the rule that matters most: a changed file
// is in exactly one diff section, or the prompt says what was dropped.
func assertNoDuplicateOrDropped(t *testing.T, files []diff.File, in Input) {
	t.Helper()
	for _, file := range files {
		inSemantic := strings.Contains(in.Semantic, "### "+file.Path+"\n")
		inRaw := strings.Contains(in.RawDiff, "diff --git a/"+file.Path+" ")
		if inSemantic && inRaw {
			t.Fatalf("%s appears in both diff sections", file.Path)
		}
		if !inSemantic && !inRaw && in.DiffNote == "complete" {
			t.Fatalf("%s was dropped without a note", file.Path)
		}
	}
}

func writeTestFile(t *testing.T, name, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(name), err)
	}
	if err := os.WriteFile(name, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}
