package review

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	// maxGuidelineFileBytes caps how much of one document is read before the
	// shared budget applies. A pathological file must not exhaust memory.
	maxGuidelineFileBytes = 64 << 10
	// maxGuidelinesBytes caps the whole guidelines section of the prompt.
	maxGuidelinesBytes = 12 << 10
)

// guidelinePaths is the fixed reading order. It matches the repository docs the
// design names, root files first so the closest convention wins the budget.
var guidelinePaths = []string{
	"AGENTS.md",
	"CLAUDE.md",
	"CONTRIBUTING.md",
	".github/CONTRIBUTING.md",
}

// Guidelines reads the repository's own convention documents from dir. Missing
// documents are not an error: many repositories have none and the review still
// runs. Each section is prefixed with its path so a finding can cite it.
func Guidelines(ctx context.Context, dir string) string {
	if dir == "" {
		return ""
	}
	sections := make([]string, 0, len(guidelinePaths))
	for _, name := range guidelinePaths {
		if ctx.Err() != nil {
			break
		}
		body := readGuideline(filepath.Join(dir, name))
		if body == "" {
			continue
		}
		sections = append(sections, "## "+filepath.ToSlash(name)+"\n\n"+body)
	}
	if len(sections) == 0 {
		return ""
	}
	return truncateMarked(strings.Join(sections, "\n\n"), maxGuidelinesBytes)
}

// readGuideline returns one trimmed document, or an empty string when it is
// absent or unreadable.
func readGuideline(name string) string {
	file, err := os.Open(name)
	if err != nil {
		return ""
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxGuidelineFileBytes))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
