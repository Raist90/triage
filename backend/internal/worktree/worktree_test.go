package worktree

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Raist90/triage/backend/internal/config"
)

type fixture struct {
	origin  string
	clone   string
	root    string
	baseSHA string
	headSHA string
	source  config.Repo
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}

	base := t.TempDir()
	f := &fixture{
		origin: filepath.Join(base, "origin.git"),
		clone:  filepath.Join(base, "clone"),
		root:   filepath.Join(base, "worktrees"),
	}

	git(t, base, "init", "--bare", "--initial-branch=main", f.origin)
	git(t, base, "clone", f.origin, f.clone)
	git(t, f.clone, "config", "user.email", "test@example.com")
	git(t, f.clone, "config", "user.name", "Test")
	git(t, f.clone, "config", "commit.gpgsign", "false")
	git(t, f.clone, "config", "tag.gpgsign", "false")

	writeFile(t, filepath.Join(f.clone, "README.md"), "base\n")
	git(t, f.clone, "add", ".")
	git(t, f.clone, "commit", "-m", "base")
	f.baseSHA = git(t, f.clone, "rev-parse", "HEAD")
	git(t, f.clone, "push", "origin", "main")

	writeFile(t, filepath.Join(f.clone, "README.md"), "head\n")
	git(t, f.clone, "add", ".")
	git(t, f.clone, "commit", "-m", "head")
	f.headSHA = git(t, f.clone, "rev-parse", "HEAD")

	// Publish the PR head on the bare origin only: base stays behind.
	git(t, f.clone, "push", "origin", f.headSHA+":refs/pull/1/head")
	git(t, f.clone, "push", "origin", f.headSHA+":refs/pull/2/head")

	f.source = config.Repo{Owner: "acme", Name: "widget", Path: f.clone}
	return f
}

func TestEnsureCreatesDetachedWorktree(t *testing.T) {
	f := newFixture(t)
	manager := New(f.root, nil)

	info, err := manager.Ensure(context.Background(), f.source, 1, f.headSHA, "main")
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	wantDir := filepath.Join(f.root, "acme", "widget", "1")
	if info.Dir != wantDir {
		t.Fatalf("dir = %q, want %q", info.Dir, wantDir)
	}
	if info.SHA != f.headSHA {
		t.Fatalf("sha = %q, want %q", info.SHA, f.headSHA)
	}
	if info.BaseSHA != f.baseSHA {
		t.Fatalf("base sha = %q, want %q", info.BaseSHA, f.baseSHA)
	}
	if info.BaseBranch != "main" {
		t.Fatalf("base branch = %q, want main", info.BaseBranch)
	}
	if got := git(t, info.Dir, "rev-parse", "HEAD"); got != f.headSHA {
		t.Fatalf("worktree HEAD = %q, want %q", got, f.headSHA)
	}
	if got := git(t, info.Dir, "rev-parse", "--abbrev-ref", "HEAD"); got != "HEAD" {
		t.Fatalf("worktree is not detached: %q", got)
	}
	if got := readFile(t, filepath.Join(info.Dir, "README.md")); got != "head\n" {
		t.Fatalf("worktree content = %q, want head", got)
	}
}

func TestEnsureReusesSameWorktree(t *testing.T) {
	f := newFixture(t)
	manager := New(f.root, nil)

	first, err := manager.Ensure(context.Background(), f.source, 1, f.headSHA, "main")
	if err != nil {
		t.Fatalf("first Ensure: %v", err)
	}
	marker := filepath.Join(first.Dir, "marker.txt")
	writeFile(t, marker, "kept\n")

	second, err := manager.Ensure(context.Background(), f.source, 1, f.headSHA, "main")
	if err != nil {
		t.Fatalf("second Ensure: %v", err)
	}
	if second.Dir != first.Dir {
		t.Fatalf("dir changed: %q then %q", first.Dir, second.Dir)
	}
	if got := readFile(t, marker); got != "kept\n" {
		t.Fatalf("worktree was recreated, marker = %q", got)
	}
}

func TestEnsureRecreatesOnNewSHA(t *testing.T) {
	f := newFixture(t)
	manager := New(f.root, nil)

	first, err := manager.Ensure(context.Background(), f.source, 1, f.headSHA, "main")
	if err != nil {
		t.Fatalf("first Ensure: %v", err)
	}
	marker := filepath.Join(first.Dir, "marker.txt")
	writeFile(t, marker, "stale\n")

	// A new commit on the PR ref with a different SHA.
	git(t, f.clone, "switch", "--detach", f.headSHA)
	writeFile(t, filepath.Join(f.clone, "README.md"), "moved\n")
	git(t, f.clone, "add", ".")
	git(t, f.clone, "commit", "-m", "moved")
	moved := git(t, f.clone, "rev-parse", "HEAD")
	git(t, f.clone, "push", "origin", moved+":refs/pull/1/head")

	second, err := manager.Ensure(context.Background(), f.source, 1, moved, "main")
	if err != nil {
		t.Fatalf("second Ensure: %v", err)
	}
	if second.SHA != moved {
		t.Fatalf("sha = %q, want %q", second.SHA, moved)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("worktree was not recreated, marker still present")
	}
	if got := readFile(t, filepath.Join(second.Dir, "README.md")); got != "moved\n" {
		t.Fatalf("worktree content = %q, want moved", got)
	}
}

func TestEnsureMissingPath(t *testing.T) {
	manager := New(t.TempDir(), nil)
	// Without git on PATH a git call would fail differently; a missing path
	// must short-circuit before any command runs.
	t.Setenv("PATH", t.TempDir())

	source := config.Repo{Owner: "acme", Name: "widget", Path: filepath.Join(t.TempDir(), "absent")}
	_, err := manager.Ensure(context.Background(), source, 1, strings.Repeat("a", 40), "main")
	var typed *Error
	if !errors.As(err, &typed) {
		t.Fatalf("error = %v, want typed Error", err)
	}
	if typed.Code != CodeRepoPathMissing {
		t.Fatalf("code = %q, want %q", typed.Code, CodeRepoPathMissing)
	}
}

func TestEnsureInvalidRepoPath(t *testing.T) {
	manager := New(t.TempDir(), nil)
	source := config.Repo{Owner: "acme", Name: "widget", Path: t.TempDir()}

	_, err := manager.Ensure(context.Background(), source, 1, strings.Repeat("a", 40), "main")
	var typed *Error
	if !errors.As(err, &typed) {
		t.Fatalf("error = %v, want typed Error", err)
	}
	if typed.Code != CodeRepoPathInvalid {
		t.Fatalf("code = %q, want %q", typed.Code, CodeRepoPathInvalid)
	}
}

func TestRemoveLeavesSourceCloneUntouched(t *testing.T) {
	f := newFixture(t)
	manager := New(f.root, nil)

	info, err := manager.Ensure(context.Background(), f.source, 1, f.headSHA, "main")
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	before := snapshot(t, f.clone)
	if err := manager.Remove(context.Background(), f.source, 1); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(info.Dir); !os.IsNotExist(err) {
		t.Fatalf("worktree still present at %s", info.Dir)
	}
	after := snapshot(t, f.clone)
	if before != after {
		t.Fatalf("source clone changed:\nbefore:\n%s\nafter:\n%s", before, after)
	}

	// Removing again is a no-op.
	if err := manager.Remove(context.Background(), f.source, 1); err != nil {
		t.Fatalf("second Remove: %v", err)
	}
}

func TestClearRemovesEveryWorktree(t *testing.T) {
	f := newFixture(t)
	manager := New(f.root, nil)

	if _, err := manager.Ensure(context.Background(), f.source, 1, f.headSHA, "main"); err != nil {
		t.Fatalf("Ensure 1: %v", err)
	}
	if _, err := manager.Ensure(context.Background(), f.source, 2, f.headSHA, "main"); err != nil {
		t.Fatalf("Ensure 2: %v", err)
	}

	removed, err := manager.Clear(context.Background(), []config.Repo{f.source})
	if err != nil {
		t.Fatalf("Clear: %v", err)
	}
	if removed != 2 {
		t.Fatalf("removed = %d, want 2", removed)
	}
	if entries, err := os.ReadDir(f.root); err == nil && len(entries) != 0 {
		t.Fatalf("root still holds %d entries", len(entries))
	}

	list := git(t, f.clone, "worktree", "list", "--porcelain")
	if strings.Count(list, "worktree ") != 1 {
		t.Fatalf("registrations not pruned:\n%s", list)
	}

	fresh := New(filepath.Join(t.TempDir(), "missing"), nil)
	count, err := fresh.Clear(context.Background(), nil)
	if err != nil || count != 0 {
		t.Fatalf("fresh Clear = %d, %v; want 0, nil", count, err)
	}
}

func TestEnsureRejectsTraversalBranchBeforeCommands(t *testing.T) {
	manager := New(t.TempDir(), nil)
	t.Setenv("PATH", t.TempDir())

	source := config.Repo{Owner: "acme", Name: "widget", Path: filepath.Join(t.TempDir(), "absent")}
	_, err := manager.Ensure(context.Background(), source, 1, strings.Repeat("a", 40), "feature..evil")
	var typed *Error
	if !errors.As(err, &typed) {
		t.Fatalf("error = %v, want typed Error", err)
	}
	if typed.Code != CodeWorktreeFailed {
		t.Fatalf("code = %q, want %q", typed.Code, CodeWorktreeFailed)
	}
}

func TestFirstLineRedactsCredentials(t *testing.T) {
	line := firstLine("fatal: repository 'https://user:secret-token@example.com/repo.git' not found\nsecond line")
	if strings.Contains(line, "secret-token") {
		t.Fatalf("credential leaked: %q", line)
	}
	if strings.Contains(line, "\n") {
		t.Fatalf("not a single line: %q", line)
	}
	if !strings.Contains(line, "https://***@example.com/repo.git") {
		t.Fatalf("unexpected redaction: %q", line)
	}
}

func TestStatus(t *testing.T) {
	f := newFixture(t)

	tests := []struct {
		name   string
		path   string
		want   bool
		reason string
	}{
		{name: "empty", path: "", want: false, reason: reasonNoPath},
		{name: "missing", path: filepath.Join(t.TempDir(), "absent"), want: false, reason: reasonNoDir},
		{name: "not a repo", path: t.TempDir(), want: false, reason: reasonNotRepo},
		{name: "repo", path: f.clone, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ok, reason := Status(context.Background(), test.path)
			if ok != test.want || reason != test.reason {
				t.Fatalf("Status(%q) = %v, %q; want %v, %q", test.path, ok, reason, test.want, test.reason)
			}
		})
	}
}

// snapshot records what Ensure and Remove must never change in the source clone.
func snapshot(t *testing.T, dir string) string {
	t.Helper()
	parts := []string{
		git(t, dir, "rev-parse", "HEAD"),
		git(t, dir, "rev-parse", "--abbrev-ref", "HEAD"),
		git(t, dir, "status", "--porcelain"),
		git(t, dir, "config", "--local", "--list"),
		readFile(t, filepath.Join(dir, "README.md")),
	}
	return strings.Join(parts, "\n")
}

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
