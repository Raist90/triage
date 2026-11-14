package api

import (
	"testing"

	"github.com/Raist90/triage/backend/internal/config"
)

func TestRepoReviewAvailability(t *testing.T) {
	tests := []struct {
		name            string
		path            string
		claudeAvailable bool
		wantAvailable   bool
		wantReason      string
	}{
		{
			name:            "path and CLI",
			path:            "/Users/example/web",
			claudeAvailable: true,
			wantAvailable:   true,
		},
		{
			name:            "path without CLI",
			path:            "/Users/example/web",
			claudeAvailable: false,
			wantAvailable:   false,
		},
		{
			name:            "no path",
			claudeAvailable: true,
			wantAvailable:   false,
			wantReason:      "No local path configured",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := repoReview(config.Repo{Path: test.path}, test.claudeAvailable)
			if got.Available != test.wantAvailable {
				t.Fatalf("available = %v, want %v", got.Available, test.wantAvailable)
			}
			if got.Reason != test.wantReason {
				t.Fatalf("reason = %q, want %q", got.Reason, test.wantReason)
			}
		})
	}
}
