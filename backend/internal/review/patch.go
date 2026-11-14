package review

import (
	"context"
	"os"
	"os/exec"
	"path"
	"strings"
	"time"

	"github.com/Raist90/triage/backend/internal/diff"
)

const (
	patchCheckTimeout = 10 * time.Second
	maxPatchTotal     = 32 << 10
)

// ValidatePatches decides, per finding, whether the suggested patch is a
// unified diff that only touches files in the pull request and that git would
// accept in this worktree. It never applies anything: a patch that fails the
// check is cleared and the finding stays.
func ValidatePatches(ctx context.Context, dir string, r Review, files []diff.File) Review {
	allowed := allowedPaths(files)
	accepted := 0

	for index := range r.Findings {
		patch := r.Findings[index].Patch
		if patch == "" {
			continue
		}
		if accepted+len(patch) > maxPatchTotal {
			r.Findings[index].Patch = ""
			continue
		}
		if !validPatch(ctx, dir, patch, allowed) {
			r.Findings[index].Patch = ""
			continue
		}
		accepted += len(patch)
	}
	return r
}

func allowedPaths(files []diff.File) map[string]struct{} {
	allowed := make(map[string]struct{}, len(files)*2)
	for _, file := range files {
		if name := normalizeFindingPath(file.Path); name != "" {
			allowed[name] = struct{}{}
		}
		if name := normalizeFindingPath(file.OldPath); name != "" {
			allowed[name] = struct{}{}
		}
	}
	return allowed
}

func validPatch(ctx context.Context, dir, patch string, allowed map[string]struct{}) bool {
	if dir == "" || len(patch) > maxPatchBytes {
		return false
	}
	parsed := diff.Parse([]byte(patch))
	if len(parsed) == 0 {
		return false
	}
	for _, file := range parsed {
		if !permittedPath(file.Path, allowed) {
			return false
		}
		if file.OldPath != "" && !permittedPath(file.OldPath, allowed) {
			return false
		}
	}
	return applyCheck(ctx, dir, patch)
}

// permittedPath rejects absolute paths, traversal and anything outside the set
// of files the pull request changes.
func permittedPath(name string, allowed map[string]struct{}) bool {
	value := normalizeFindingPath(name)
	if value == "" || strings.HasPrefix(value, "/") || path.IsAbs(value) {
		return false
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." {
			return false
		}
	}
	_, ok := allowed[value]
	return ok
}

func applyCheck(ctx context.Context, dir, patch string) bool {
	ctx, cancel := context.WithTimeout(ctx, patchCheckTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "apply", "--check", "--whitespace=nowarn")
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(patch)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	return cmd.Run() == nil
}
