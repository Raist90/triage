package worktree

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

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
