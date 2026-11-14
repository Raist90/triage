// Package worktree manages disposable checkouts of a pull request head under
// ~/.triage/worktrees. It never creates a clone, never modifies the source
// clone's working tree, branches or config, and never pushes.
package worktree

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Raist90/triage/backend/internal/config"
)

// Error codes shared with the action envelope.
const (
	CodeRepoPathMissing = "repo_path_missing"
	CodeRepoPathInvalid = "repo_path_invalid"
	CodeWorktreeFailed  = "worktree_failed"
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

// Error is a classified worktree failure. Message is safe for the webview.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

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

// commandError carries the one-line stderr detail of a failed git command.
type commandError struct {
	err    error
	detail string
}

func (e *commandError) Error() string { return e.detail }
func (e *commandError) Unwrap() error { return e.err }

// failed wraps a git failure into a safe typed Error.
func failed(code, what string, err error) *Error {
	detail := "git command failed"
	var cmdErr *commandError
	if errors.As(err, &cmdErr) && cmdErr.detail != "" {
		detail = cmdErr.detail
	}
	return &Error{Code: code, Message: what + ": " + detail}
}

// runGit runs one git command with a prompt-free environment and a bounded
// stderr buffer. dir becomes the command working directory.
func runGit(ctx context.Context, dir string, timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = gitEnv()

	var stdout bytes.Buffer
	stderr := &boundedBuffer{max: maxStderrBytes}
	cmd.Stdout = &stdout
	cmd.Stderr = stderr

	if err := cmd.Run(); err != nil {
		detail := firstLine(stderr.String())
		if detail == "" {
			switch {
			case errors.Is(ctx.Err(), context.DeadlineExceeded):
				detail = "timed out"
			case errors.Is(ctx.Err(), context.Canceled):
				detail = "canceled"
			default:
				detail = "git command failed"
			}
		}
		return "", &commandError{err: err, detail: detail}
	}
	return strings.TrimSpace(stdout.String()), nil
}

// boundedBuffer keeps at most max bytes and silently drops the rest.
type boundedBuffer struct {
	buf bytes.Buffer
	max int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if room := b.max - b.buf.Len(); room > 0 {
		if len(p) > room {
			b.buf.Write(p[:room])
		} else {
			b.buf.Write(p)
		}
	}
	return len(p), nil
}

func (b *boundedBuffer) String() string { return b.buf.String() }

// gitEnv returns the process environment with terminal prompting disabled.
func gitEnv() []string {
	env := make([]string, 0, len(os.Environ())+1)
	for _, entry := range os.Environ() {
		if strings.HasPrefix(entry, "GIT_TERMINAL_PROMPT=") {
			continue
		}
		env = append(env, entry)
	}
	return append(env, "GIT_TERMINAL_PROMPT=0")
}

// firstLine trims stderr to one line of at most maxMessageLen bytes and strips
// credentials embedded in a remote URL.
func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(credentialPattern.ReplaceAllString(s, "${1}***@"))
	if len(s) > maxMessageLen {
		s = strings.TrimSpace(s[:maxMessageLen])
	}
	return s
}

var (
	shaPattern        = regexp.MustCompile(`^[0-9a-fA-F]{7,64}$`)
	credentialPattern = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://)[^@\s/]+@`)
)

// validBranch checks every slash-separated segment of a branch name.
func validBranch(name string) bool {
	if name == "" {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if !validSegment(part) {
			return false
		}
	}
	return true
}

// validSegment applies conservative git ref rules: no whitespace or control
// characters, no revision syntax, no traversal, no leading dash or dot.
func validSegment(segment string) bool {
	if segment == "" || strings.Contains(segment, "/") {
		return false
	}
	if strings.HasPrefix(segment, "-") || strings.HasPrefix(segment, ".") || strings.HasSuffix(segment, ".") {
		return false
	}
	if strings.Contains(segment, "..") || strings.Contains(segment, "@{") {
		return false
	}
	if strings.ContainsAny(segment, ` ~^:?*[\`) {
		return false
	}
	for i := 0; i < len(segment); i++ {
		if segment[i] < 0x20 || segment[i] == 0x7f {
			return false
		}
	}
	return true
}

// samePath compares two paths after resolving symlinks when possible.
func samePath(a, b string) bool {
	cleanA, cleanB := filepath.Clean(a), filepath.Clean(b)
	if cleanA == cleanB {
		return true
	}
	resolvedA, errA := filepath.EvalSymlinks(cleanA)
	resolvedB, errB := filepath.EvalSymlinks(cleanB)
	if errA != nil || errB != nil {
		return false
	}
	return resolvedA == resolvedB
}
