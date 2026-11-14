package api

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/Raist90/triage/backend/internal/config"
	"github.com/Raist90/triage/backend/internal/worktree"
)

func TestRepoReviewAvailability(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}

	repoDir := t.TempDir()
	if out, err := exec.Command("git", "init", repoDir).CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	notRepo := t.TempDir()
	missing := filepath.Join(t.TempDir(), "absent")
	manager := worktree.New(filepath.Join(t.TempDir(), "worktrees"), nil)

	tests := []struct {
		name            string
		path            string
		claudeAvailable bool
		wantAvailable   bool
		wantReason      string
	}{
		{
			name:            "path and CLI",
			path:            repoDir,
			claudeAvailable: true,
			wantAvailable:   true,
		},
		{
			name:            "path without CLI",
			path:            repoDir,
			claudeAvailable: false,
			wantAvailable:   false,
		},
		{
			name:            "no path",
			claudeAvailable: true,
			wantAvailable:   false,
			wantReason:      "No local path configured",
		},
		{
			name:            "missing path",
			path:            missing,
			claudeAvailable: true,
			wantAvailable:   false,
			wantReason:      "Path does not exist",
		},
		{
			name:            "not a git repository",
			path:            notRepo,
			claudeAvailable: true,
			wantAvailable:   false,
			wantReason:      "Not a git repository",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := repoReview(context.Background(), manager, config.Repo{Path: test.path}, test.claudeAvailable)
			if got.Available != test.wantAvailable {
				t.Fatalf("available = %v, want %v", got.Available, test.wantAvailable)
			}
			if got.Reason != test.wantReason {
				t.Fatalf("reason = %q, want %q", got.Reason, test.wantReason)
			}
		})
	}
}
