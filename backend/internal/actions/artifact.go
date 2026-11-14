// Package actions runs Claude Code over a pull request's diff and stores the
// resulting markdown artifacts under ~/.triage/artifacts.
package actions

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/Raist90/triage/backend/internal/review"
)

var actionIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// ValidActionID reports whether id is safe to use as a path segment.
func ValidActionID(id string) bool {
	return actionIDPattern.MatchString(id)
}

// Usage is the token and cost summary reported by the CLI.
type Usage struct {
	InputTokens  int     `json:"inputTokens"`
	OutputTokens int     `json:"outputTokens"`
	TotalCostUSD float64 `json:"totalCostUsd"`
}

// Artifact is one finished answer for a specific SHA, model and prompt version.
// An explain artifact carries Markdown and a nil Review; a review artifact
// carries Review and the worktree its patches apply to.
type Artifact struct {
	ActionID      string         `json:"action"`
	Model         string         `json:"model"`
	SHA           string         `json:"sha"`
	PromptVersion string         `json:"promptVersion"`
	CreatedAt     time.Time      `json:"createdAt"`
	Markdown      string         `json:"markdown"`
	Usage         Usage          `json:"usage"`
	Review        *review.Review `json:"review,omitempty"`
	Worktree      string         `json:"worktree,omitempty"`
}

// Store is a directory of artifact files.
type Store struct {
	root string
}

// DefaultDir is ~/.triage/artifacts.
func DefaultDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("actions: resolve home directory: %w", err)
	}
	return filepath.Join(home, ".triage", "artifacts"), nil
}

// NewStore returns a store rooted at root.
func NewStore(root string) *Store {
	return &Store{root: root}
}

// Dir is the artifact root.
func (s *Store) Dir() string {
	return s.root
}

// Get reads the artifact for exactly this SHA and action.
func (s *Store) Get(owner, repo string, number int, sha, actionID string) (*Artifact, bool) {
	if !ValidActionID(actionID) || sha == "" {
		return nil, false
	}
	path := s.path(owner, repo, number, sha, actionID)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	var artifact Artifact
	if err := json.Unmarshal(data, &artifact); err != nil {
		return nil, false
	}
	return &artifact, true
}

// Latest returns the newest artifact for this PR and action, regardless of SHA.
// Callers compare SHA to decide whether it is stale.
func (s *Store) Latest(owner, repo string, number int, actionID string) (*Artifact, bool) {
	if !ValidActionID(actionID) {
		return nil, false
	}
	prDir := filepath.Join(s.root, owner, repo, fmt.Sprintf("%d", number))
	entries, err := os.ReadDir(prDir)
	if err != nil {
		return nil, false
	}
	var newest *Artifact
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		candidate, ok := s.Get(owner, repo, number, entry.Name(), actionID)
		if !ok {
			continue
		}
		if newest == nil || candidate.CreatedAt.After(newest.CreatedAt) {
			newest = candidate
		}
	}
	return newest, newest != nil
}

// Put writes an artifact atomically.
func (s *Store) Put(owner, repo string, number int, artifact Artifact) error {
	if !ValidActionID(artifact.ActionID) || artifact.SHA == "" {
		return errors.New("actions: invalid artifact identity")
	}
	data, err := json.Marshal(artifact)
	if err != nil {
		return fmt.Errorf("actions: encode artifact: %w", err)
	}
	path := s.path(owner, repo, number, artifact.SHA, artifact.ActionID)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("actions: create artifact directory: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return fmt.Errorf("actions: create artifact temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("actions: chmod artifact: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("actions: write artifact: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("actions: write artifact: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("actions: commit artifact: %w", err)
	}
	return nil
}

// Clear removes every artifact and reports how many files were removed.
func (s *Store) Clear() (int, error) {
	cleared := 0
	err := filepath.WalkDir(s.root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			cleared++
		}
		return nil
	})
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, fmt.Errorf("actions: count artifacts: %w", err)
	}
	if err := os.RemoveAll(s.root); err != nil {
		return cleared, fmt.Errorf("actions: clear artifacts: %w", err)
	}
	return cleared, nil
}

func (s *Store) path(owner, repo string, number int, sha, actionID string) string {
	return filepath.Join(s.root, owner, repo, fmt.Sprintf("%d", number), sha, actionID+".json")
}
