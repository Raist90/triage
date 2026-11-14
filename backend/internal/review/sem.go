package review

import (
	"context"
	"os/exec"
	"path"
	"strings"
	"time"
)

// semTimeout bounds one sem run. sem may index the repository on its first run
// inside a fresh worktree, so this is generous. A miss degrades to the raw diff.
const semTimeout = 60 * time.Second

// Semantic returns sem's markdown report for base..head together with the set of
// files the report covers. ok is false on a missing binary, a non-zero exit, an
// empty report or a timeout; callers then fall back to the raw diff.
//
// The markdown is the prompt input, and its headings are the coverage map. sem
// runs once, never twice.
func Semantic(ctx context.Context, dir, baseSHA, headSHA string) (string, map[string]bool, bool) {
	if dir == "" || baseSHA == "" || headSHA == "" {
		return "", nil, false
	}
	binary, err := exec.LookPath("sem")
	if err != nil {
		return "", nil, false
	}

	ctx, cancel := context.WithTimeout(ctx, semTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, binary,
		"diff", "--format", "markdown", "--verbose",
		"--from", baseSHA, "--to", headSHA,
	)
	cmd.Dir = dir
	output, err := cmd.Output()
	if err != nil {
		return "", nil, false
	}

	markdown := string(output)
	if strings.TrimSpace(markdown) == "" {
		return "", nil, false
	}
	return markdown, semanticPaths(markdown), true
}

// semanticPaths reads the one-file-per-heading structure of sem's markdown
// report. Anything inside a fenced code block is ignored, so a diff or a code
// sample that happens to contain a "###" line cannot fake coverage.
func semanticPaths(markdown string) map[string]bool {
	covered := make(map[string]bool)
	fenced := false
	for _, raw := range strings.Split(markdown, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "```") || strings.HasPrefix(line, "~~~") {
			fenced = !fenced
			continue
		}
		if fenced || !strings.HasPrefix(line, "### ") {
			continue
		}
		name := normalizeSemPath(strings.TrimPrefix(line, "### "))
		if name == "" {
			continue
		}
		covered[name] = true
	}
	return covered
}

// normalizeSemPath turns a heading into the same path shape diff.Parse reports:
// no backticks, no a/ or b/ prefix, no redundant segments.
func normalizeSemPath(raw string) string {
	name := strings.TrimSpace(raw)
	name = strings.Trim(name, "`")
	name = strings.Trim(name, `"`)
	name = strings.TrimSpace(name)
	name = strings.TrimPrefix(name, "a/")
	name = strings.TrimPrefix(name, "b/")
	name = path.Clean(name)
	if name == "" || name == "." || name == "/dev/null" {
		return ""
	}
	return name
}
