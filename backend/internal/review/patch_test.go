package review

import (
	"context"
	"errors"
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

func TestApplyPatchChangesWorktree(t *testing.T) {
	dir := gitRepo(t)
	if err := ApplyPatch(context.Background(), dir, trackerPatch, []diff.File{{Path: "tracker.go"}}); err != nil {
		t.Fatalf("ApplyPatch: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "tracker.go"))
	if err != nil {
		t.Fatalf("read tracker.go: %v", err)
	}
	if string(body) != "package new\n" {
		t.Fatalf("tracker.go = %q, want the patched content", body)
	}
}

func TestApplyPatchRejectsUnlistedPath(t *testing.T) {
	dir := gitRepo(t)
	patch := strings.ReplaceAll(trackerPatch, "tracker.go", "other.go")
	err := ApplyPatch(context.Background(), dir, patch, []diff.File{{Path: "tracker.go"}})
	if !errors.Is(err, ErrPatchRejected) {
		t.Fatalf("err = %v, want ErrPatchRejected", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "other.go")); !os.IsNotExist(statErr) {
		t.Fatal("a rejected patch must not write a file")
	}
}

func TestApplyPatchConflictLeavesFileUntouched(t *testing.T) {
	dir := gitRepo(t)
	runGit(t, dir, "config", "user.email", "test@example.com")
	runGit(t, dir, "config", "user.name", "test")
	runGit(t, dir, "commit", "-qm", "init")
	if err := os.WriteFile(filepath.Join(dir, "tracker.go"), []byte("package different\n"), 0o600); err != nil {
		t.Fatalf("rewrite tracker.go: %v", err)
	}
	err := ApplyPatch(context.Background(), dir, trackerPatch, []diff.File{{Path: "tracker.go"}})
	if !errors.Is(err, ErrPatchConflict) {
		t.Fatalf("err = %v, want ErrPatchConflict", err)
	}
	body, readErr := os.ReadFile(filepath.Join(dir, "tracker.go"))
	if readErr != nil {
		t.Fatalf("read tracker.go: %v", readErr)
	}
	if string(body) != "package different\n" {
		t.Fatalf("tracker.go = %q, a conflict must not modify the file", body)
	}
}

func TestApplyPatchRejectsTraversalAndAbsolutePaths(t *testing.T) {
	dir := gitRepo(t)
	traversal := `diff --git a/../evil.go b/../evil.go
--- a/../evil.go
+++ b/../evil.go
@@ -1 +1 @@
-old
+new
`
	absolute := `diff --git a/tmp/evil.go b/tmp/evil.go
--- /tmp/evil.go
+++ /tmp/evil.go
@@ -1 +1 @@
-old
+new
`
	for name, patch := range map[string]string{"traversal": traversal, "absolute": absolute} {
		err := ApplyPatch(context.Background(), dir, patch, []diff.File{{Path: "tracker.go"}})
		if !errors.Is(err, ErrPatchRejected) {
			t.Fatalf("%s: err = %v, want ErrPatchRejected", name, err)
		}
	}
}

func TestApplyPatchRejectsOversizeBeforeShellingOut(t *testing.T) {
	// An empty directory proves the size cap is checked before git runs.
	dir := t.TempDir()
	big := trackerPatch + strings.Repeat("+filler\n", maxPatchBytes)
	err := ApplyPatch(context.Background(), dir, big, []diff.File{{Path: "tracker.go"}})
	if !errors.Is(err, ErrPatchRejected) {
		t.Fatalf("err = %v, want ErrPatchRejected", err)
	}
}

func TestApplyPatchRejectsBinary(t *testing.T) {
	dir := gitRepo(t)
	patch := `diff --git a/tracker.go b/tracker.go
index 0000000..1111111 100644
Binary files a/tracker.go and b/tracker.go differ
`
	err := ApplyPatch(context.Background(), dir, patch, []diff.File{{Path: "tracker.go"}})
	if !errors.Is(err, ErrPatchRejected) {
		t.Fatalf("err = %v, want ErrPatchRejected", err)
	}
}
