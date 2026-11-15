// Package worktree manages disposable checkouts of a pull request head under
// ~/.triage/worktrees. It never creates a clone, never modifies the source
// clone's working tree, branches or config, and never pushes.
package worktree

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Raist90/triage/backend/internal/config"
)

// Status reasons. The webview shows these strings verbatim.
const (
	reasonNoPath   = "No local path configured"
	reasonNoDir    = "Path does not exist"
	reasonNotRepo  = "Not a git repository"
	movedMessage   = "The pull request moved while the review was starting. Run it again."
	maxStderrBytes = 4 << 10
	maxMessageLen  = 240
)

const (
	fetchTimeout    = 120 * time.Second
	worktreeTimeout = 30 * time.Second
	gitTimeout      = 15 * time.Second
)

// Info describes a ready worktree.
type Info struct {
	Dir        string
	SHA        string
	BaseSHA    string
	BaseBranch string
}

// Manager owns the worktree root and the per-PR locks.
type Manager struct {
	root   string
	logger *slog.Logger

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

// DefaultRoot is ~/.triage/worktrees.
func DefaultRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("worktree: resolve home directory: %w", err)
	}
	return filepath.Join(home, ".triage", "worktrees"), nil
}

// New returns a manager rooted at root. A nil logger disables logging.
func New(root string, logger *slog.Logger) *Manager {
	return &Manager{root: root, logger: logger, locks: map[string]*sync.Mutex{}}
}

// Status reports whether automatic review can run against path. The reason is
// empty when the path is usable.
func Status(ctx context.Context, path string) (bool, string) {
	if strings.TrimSpace(path) == "" {
		return false, reasonNoPath
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return false, reasonNoDir
	}
	if _, err := runGit(ctx, path, gitTimeout, "rev-parse", "--git-dir"); err != nil {
		return false, reasonNotRepo
	}
	return true, ""
}

// Ensure produces a detached worktree at headSHA, fetching the PR and base refs
// through the user's clone so their credentials apply.
func (m *Manager) Ensure(ctx context.Context, source config.Repo, number int, headSHA, baseBranch string) (Info, error) {
	// Names are validated before anything touches git.
	if number <= 0 {
		return Info{}, &Error{Code: CodeWorktreeFailed, Message: "Invalid pull request number"}
	}
	if !validSegment(source.Owner) || !validSegment(source.Name) || !validBranch(baseBranch) {
		return Info{}, &Error{Code: CodeWorktreeFailed, Message: "Invalid repository or branch name"}
	}
	if !shaPattern.MatchString(headSHA) {
		return Info{}, &Error{Code: CodeWorktreeFailed, Message: "Invalid pull request head commit"}
	}

	if ok, reason := Status(ctx, source.Path); !ok {
		code := CodeRepoPathMissing
		if reason == reasonNotRepo {
			code = CodeRepoPathInvalid
		}
		return Info{}, &Error{Code: code, Message: reason}
	}

	unlock := m.lock(source.Owner + "/" + source.Name + "/" + strconv.Itoa(number))
	defer unlock()

	prRef := "refs/triage/pr/" + strconv.Itoa(number)
	baseRef := "refs/triage/base/" + baseBranch

	prSpec := "+refs/pull/" + strconv.Itoa(number) + "/head:" + prRef
	if _, err := runGit(ctx, source.Path, fetchTimeout, "fetch", "--no-tags", "origin", prSpec); err != nil {
		return Info{}, failed(CodeWorktreeFailed, "Fetching the pull request failed", err)
	}

	baseSpec := "+refs/heads/" + baseBranch + ":" + baseRef
	if _, err := runGit(ctx, source.Path, fetchTimeout, "fetch", "--no-tags", "origin", baseSpec); err != nil {
		return Info{}, failed(CodeWorktreeFailed, "Fetching the base branch failed", err)
	}

	fetched, err := runGit(ctx, source.Path, gitTimeout, "rev-parse", "--verify", prRef+"^{commit}")
	if err != nil {
		return Info{}, failed(CodeWorktreeFailed, "Resolving the pull request commit failed", err)
	}
	if !strings.EqualFold(fetched, headSHA) {
		return Info{}, &Error{Code: CodeWorktreeFailed, Message: movedMessage}
	}

	baseSHA, err := runGit(ctx, source.Path, gitTimeout, "merge-base", baseRef, fetched)
	if err != nil {
		return Info{}, failed(CodeWorktreeFailed, "Computing the merge base failed", err)
	}

	dir := filepath.Join(m.root, source.Owner, source.Name, strconv.Itoa(number))
	info := Info{Dir: dir, SHA: fetched, BaseSHA: baseSHA, BaseBranch: baseBranch}

	if _, statErr := os.Stat(dir); statErr == nil {
		if m.reusable(ctx, source.Path, dir, fetched) {
			return info, nil
		}
		m.removeDir(ctx, source.Path, dir)
	}

	if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
		return Info{}, &Error{Code: CodeWorktreeFailed, Message: "Creating the worktree directory failed"}
	}
	if _, err := runGit(ctx, source.Path, worktreeTimeout, "worktree", "add", "--detach", dir, fetched); err != nil {
		return Info{}, failed(CodeWorktreeFailed, "Creating the worktree failed", err)
	}

	head, err := runGit(ctx, dir, gitTimeout, "rev-parse", "HEAD")
	if err != nil {
		return Info{}, failed(CodeWorktreeFailed, "Verifying the worktree failed", err)
	}
	if !strings.EqualFold(head, fetched) {
		return Info{}, &Error{Code: CodeWorktreeFailed, Message: "The worktree ended up on the wrong commit"}
	}
	return info, nil
}

// Remove deletes one PR's worktree and prunes the source clone's registration.
// A missing directory is not an error.
func (m *Manager) Remove(ctx context.Context, source config.Repo, number int) error {
	if number <= 0 || !validSegment(source.Owner) || !validSegment(source.Name) {
		return &Error{Code: CodeWorktreeFailed, Message: "Invalid repository or pull request number"}
	}
	dir := filepath.Join(m.root, source.Owner, source.Name, strconv.Itoa(number))
	if !m.owns(dir) {
		return &Error{Code: CodeWorktreeFailed, Message: "Worktree path is outside the manager root"}
	}
	if _, err := os.Lstat(dir); os.IsNotExist(err) {
		return nil
	}

	if ok, reason := Status(ctx, source.Path); !ok {
		code := CodeRepoPathMissing
		if reason == reasonNotRepo {
			code = CodeRepoPathInvalid
		}
		return &Error{Code: code, Message: reason}
	}

	if _, err := runGit(ctx, source.Path, worktreeTimeout, "worktree", "remove", "--force", dir); err != nil {
		// A directory that is no longer a registered worktree still belongs
		// under our root: remove the files and prune the stale registration.
		if rmErr := os.RemoveAll(dir); rmErr != nil {
			return failed(CodeWorktreeFailed, "Removing the worktree failed", err)
		}
	}
	if _, err := runGit(ctx, source.Path, gitTimeout, "worktree", "prune"); err != nil {
		m.warn("worktree prune failed", "path", dir, "err", err)
	}
	return nil
}

// Clear removes every worktree under the root and prunes each source clone.
// The root is created lazily, so a fresh install returns 0.
func (m *Manager) Clear(ctx context.Context, sources []config.Repo) (int, error) {
	removed, err := m.clearRoot()
	if err != nil {
		return removed, err
	}

	seen := map[string]struct{}{}
	var firstErr error
	for _, source := range sources {
		if strings.TrimSpace(source.Path) == "" {
			continue
		}
		clean := filepath.Clean(source.Path)
		if _, ok := seen[clean]; ok {
			continue
		}
		seen[clean] = struct{}{}
		if ok, _ := Status(ctx, source.Path); !ok {
			continue
		}
		if _, err := runGit(ctx, source.Path, gitTimeout, "worktree", "prune"); err != nil {
			m.warn("worktree prune failed", "path", clean, "err", err)
			if firstErr == nil {
				firstErr = failed(CodeWorktreeFailed, "Pruning worktree registrations failed", err)
			}
		}
	}
	return removed, firstErr
}

// clearRoot removes owner/name/number directories under the root and counts
// them. It never follows symlinks.
func (m *Manager) clearRoot() (int, error) {
	owners, err := os.ReadDir(m.root)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("worktree: read root: %w", err)
	}

	removed := 0
	for _, owner := range owners {
		if !owner.IsDir() {
			continue
		}
		ownerDir := filepath.Join(m.root, owner.Name())
		names, err := os.ReadDir(ownerDir)
		if err != nil {
			return removed, fmt.Errorf("worktree: read %s: %w", ownerDir, err)
		}
		for _, name := range names {
			if !name.IsDir() {
				continue
			}
			nameDir := filepath.Join(ownerDir, name.Name())
			numbers, err := os.ReadDir(nameDir)
			if err != nil {
				return removed, fmt.Errorf("worktree: read %s: %w", nameDir, err)
			}
			for _, number := range numbers {
				if !number.IsDir() {
					continue
				}
				dir := filepath.Join(nameDir, number.Name())
				if !m.owns(dir) {
					continue
				}
				if err := os.RemoveAll(dir); err != nil {
					return removed, fmt.Errorf("worktree: remove %s: %w", dir, err)
				}
				removed++
			}
			// Drop empty owner/name directories, ignore failures: non-empty
			// ones are not ours to remove.
			_ = os.Remove(nameDir)
		}
		_ = os.Remove(ownerDir)
	}
	return removed, nil
}

// reusable reports whether dir is a worktree of sourcePath checked out at sha.
func (m *Manager) reusable(ctx context.Context, sourcePath, dir, sha string) bool {
	head, err := runGit(ctx, dir, gitTimeout, "rev-parse", "HEAD")
	if err != nil || !strings.EqualFold(head, sha) {
		return false
	}
	toplevel, err := runGit(ctx, dir, gitTimeout, "rev-parse", "--show-toplevel")
	if err != nil {
		return false
	}
	return samePath(toplevel, dir)
}

// removeDir removes one worktree and prunes its registration. Failures fall back
// to deleting the directory, which is always under the manager root.
func (m *Manager) removeDir(ctx context.Context, sourcePath, dir string) {
	if _, err := runGit(ctx, sourcePath, worktreeTimeout, "worktree", "remove", "--force", dir); err != nil {
		if !m.owns(dir) {
			return
		}
		if rmErr := os.RemoveAll(dir); rmErr != nil {
			m.warn("worktree removal failed", "path", dir, "err", err)
			return
		}
	}
	if _, err := runGit(ctx, sourcePath, gitTimeout, "worktree", "prune"); err != nil {
		m.warn("worktree prune failed", "path", dir, "err", err)
	}
}

// owns reports whether dir is inside the manager root.
func (m *Manager) owns(dir string) bool {
	rel, err := filepath.Rel(m.root, dir)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func (m *Manager) lock(key string) func() {
	m.mu.Lock()
	mu, ok := m.locks[key]
	if !ok {
		mu = &sync.Mutex{}
		m.locks[key] = mu
	}
	m.mu.Unlock()
	mu.Lock()
	return mu.Unlock
}

func (m *Manager) warn(msg string, args ...any) {
	if m.logger != nil {
		m.logger.Warn(msg, args...)
	}
}
