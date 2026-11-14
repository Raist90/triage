package review

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Raist90/triage/backend/internal/diff"
)

const trackerPatch = `diff --git a/tracker.go b/tracker.go
--- a/tracker.go
+++ b/tracker.go
@@ -1 +1 @@
-package old
+package new
`

func gitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGit(t, dir, "init", "-q")
	if err := os.WriteFile(filepath.Join(dir, "tracker.go"), []byte("package old\n"), 0o600); err != nil {
		t.Fatalf("write tracker.go: %v", err)
	}
	runGit(t, dir, "add", "tracker.go")
	return dir
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
}

func patchReview(patch string) Review {
	return Review{
		Verdict:  Verdict{SafeToMerge: true, Summary: "ok"},
		Findings: []Finding{{ID: "F1", Severity: SeverityWarning, Category: CategoryRisk, Title: "t", File: "tracker.go", Line: 1, Patch: patch}},
	}
}

func TestValidatePatchesKeepsValidPatch(t *testing.T) {
	dir := gitRepo(t)
	out := ValidatePatches(context.Background(), dir, patchReview(trackerPatch), []diff.File{{Path: "tracker.go"}})
	if out.Findings[0].Patch == "" {
		t.Fatal("a valid patch must survive")
	}
}

func TestValidatePatchesClearsUnlistedFile(t *testing.T) {
	dir := gitRepo(t)
	patch := strings.ReplaceAll(trackerPatch, "tracker.go", "other.go")
	out := ValidatePatches(context.Background(), dir, patchReview(patch), []diff.File{{Path: "tracker.go"}})
	if out.Findings[0].Patch != "" {
		t.Fatal("a patch touching an unlisted file must be cleared")
	}
	if len(out.Findings) != 1 {
		t.Fatal("the finding must stay")
	}
}

func TestValidatePatchesClearsConflict(t *testing.T) {
	dir := gitRepo(t)
	runGit(t, dir, "config", "user.email", "test@example.com")
	runGit(t, dir, "config", "user.name", "test")
	runGit(t, dir, "commit", "-qm", "init")
	if err := os.WriteFile(filepath.Join(dir, "tracker.go"), []byte("package different\n"), 0o600); err != nil {
		t.Fatalf("rewrite tracker.go: %v", err)
	}
	out := ValidatePatches(context.Background(), dir, patchReview(trackerPatch), []diff.File{{Path: "tracker.go"}})
	if out.Findings[0].Patch != "" {
		t.Fatal("a patch that fails git apply --check must be cleared")
	}
}

func TestValidatePatchesClearsTraversal(t *testing.T) {
	dir := gitRepo(t)
	patch := `diff --git a/../evil.go b/../evil.go
--- a/../evil.go
+++ b/../evil.go
@@ -1 +1 @@
-old
+new
`
	out := ValidatePatches(context.Background(), dir, patchReview(patch), []diff.File{{Path: "tracker.go"}})
	if out.Findings[0].Patch != "" {
		t.Fatal("a traversal path must be cleared")
	}
}

func TestValidatePatchesClearsAbsolutePath(t *testing.T) {
	dir := gitRepo(t)
	patch := `diff --git a/tmp/evil.go b/tmp/evil.go
--- /tmp/evil.go
+++ /tmp/evil.go
@@ -1 +1 @@
-old
+new
`
	out := ValidatePatches(context.Background(), dir, patchReview(patch), []diff.File{{Path: "tracker.go"}})
	if out.Findings[0].Patch != "" {
		t.Fatal("an absolute path must be cleared")
	}
}

func TestValidatePatchesClearsNonDiff(t *testing.T) {
	dir := gitRepo(t)
	out := ValidatePatches(context.Background(), dir, patchReview("not a unified diff"), []diff.File{{Path: "tracker.go"}})
	if out.Findings[0].Patch != "" {
		t.Fatal("a non-diff patch must be cleared")
	}
}
