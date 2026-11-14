// Package diff splits unified diffs into per-file patches and annotates them
// with sem's semantic changes when the CLI is available.
package diff

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

const semTimeout = 8 * time.Second

// File is one file in a pull request diff.
type File struct {
	Path      string           `json:"path"`
	OldPath   string           `json:"oldPath,omitempty"`
	Status    string           `json:"status"`
	Additions int              `json:"additions"`
	Deletions int              `json:"deletions"`
	Patch     string           `json:"patch"`
	Hunks     []Hunk           `json:"hunks,omitempty"`
	Binary    bool             `json:"binary"`
	Kinds     []string         `json:"kinds,omitempty"`
	Semantic  []SemanticChange `json:"semantic,omitempty"`
	Review    *Review          `json:"review,omitempty"`
}

// SemanticChange is one entity sem reported as changed. Line ranges let the UI
// anchor the change to the hunk that caused it; OldFilePath marks entity moves
// across files, which a unified diff renders as an unrelated delete and add.
type SemanticChange struct {
	ChangeType    string `json:"changeType"`
	EntityType    string `json:"entityType"`
	EntityName    string `json:"entityName"`
	StartLine     int    `json:"startLine,omitempty"`
	EndLine       int    `json:"endLine,omitempty"`
	OldStartLine  int    `json:"oldStartLine,omitempty"`
	OldEndLine    int    `json:"oldEndLine,omitempty"`
	OldEntityName string `json:"oldEntityName,omitempty"`
	OldFilePath   string `json:"oldFilePath,omitempty"`
	Cosmetic      bool   `json:"cosmetic,omitempty"`

	// Kept for rewrite detection only; sem's entity bodies are far too large
	// to ship to the webview for every change.
	before string
	after  string
}

// SemanticSummary mirrors sem's own change counts so the UI can show the shape
// of a pull request before the reviewer scrolls through it.
type SemanticSummary struct {
	FileCount int `json:"fileCount"`
	Added     int `json:"added"`
	Modified  int `json:"modified"`
	Deleted   int `json:"deleted"`
	Moved     int `json:"moved"`
	Renamed   int `json:"renamed"`
	Reordered int `json:"reordered"`
	Orphan    int `json:"orphan"`
	Binary    int `json:"binary"`
	Total     int `json:"total"`
}

// Report is a usable sem result: changes keyed by file path plus the summary.
type Report struct {
	Changes map[string][]SemanticChange
	Summary SemanticSummary
}

// Response is the route payload. SemanticAvailable is false when sem is
// missing, fails, or cannot parse the patch.
type Response struct {
	Files             []File           `json:"files"`
	SemanticAvailable bool             `json:"semanticAvailable"`
	SemanticSummary   *SemanticSummary `json:"semanticSummary,omitempty"`
	Complexity        *Complexity      `json:"complexity,omitempty"`
}

// Parse splits a unified diff into files. Malformed input still produces
// whatever files could be identified; it never panics.
func Parse(unified []byte) []File {
	text := strings.ReplaceAll(string(unified), "\r\n", "\n")
	text = strings.TrimSuffix(text, "\n")
	if text == "" {
		return []File{}
	}

	files := make([]File, 0)
	var current *File
	var patch strings.Builder
	var oldPath, newPath, headerPath string
	var inHunk bool

	flush := func() {
		if current == nil {
			return
		}
		switch {
		case newPath != "":
			current.Path = newPath
		case oldPath != "":
			current.Path = oldPath
		case headerPath != "":
			current.Path = headerPath
		}
		if oldPath != "" && oldPath != current.Path {
			current.OldPath = oldPath
		}
		current.Patch = patch.String()
		files = append(files, *current)
		current = nil
		patch.Reset()
	}

	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "diff --git ") {
			flush()
			current = &File{Status: "modified"}
			oldPath, newPath = "", ""
			inHunk = false
			headerPath = diffHeaderPath(strings.TrimPrefix(line, "diff --git "))
			patch.WriteString(line)
			patch.WriteByte('\n')
			continue
		}
		if current == nil {
			continue
		}

		patch.WriteString(line)
		patch.WriteByte('\n')

		switch {
		case strings.HasPrefix(line, "@@"):
			inHunk = true
		case !inHunk && strings.HasPrefix(line, "new file mode"):
			current.Status = "added"
		case !inHunk && strings.HasPrefix(line, "deleted file mode"):
			current.Status = "removed"
		case !inHunk && strings.HasPrefix(line, "rename from "):
			oldPath = cleanPath(strings.TrimPrefix(line, "rename from "))
			current.Status = "renamed"
		case !inHunk && strings.HasPrefix(line, "rename to "):
			newPath = cleanPath(strings.TrimPrefix(line, "rename to "))
			current.Status = "renamed"
		case !inHunk && strings.HasPrefix(line, "--- "):
			oldPath = cleanPath(strings.TrimPrefix(line, "--- "))
		case !inHunk && strings.HasPrefix(line, "+++ "):
			newPath = cleanPath(strings.TrimPrefix(line, "+++ "))
		case strings.HasPrefix(line, "Binary files "), line == "GIT binary patch":
			current.Binary = true
		case current.Binary:
			// Binary payload is not line-countable.
		case strings.HasPrefix(line, "+"):
			current.Additions++
		case strings.HasPrefix(line, "-"):
			current.Deletions++
		}
	}
	flush()

	if files == nil {
		return []File{}
	}
	return files
}

// Semantic runs sem over a unified diff. Any failure degrades to the raw diff.
func Semantic(ctx context.Context, unified []byte) (Report, bool) {
	if len(unified) == 0 {
		return Report{}, false
	}
	binary, err := exec.LookPath("sem")
	if err != nil {
		return Report{}, false
	}

	ctx, cancel := context.WithTimeout(ctx, semTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, binary, "diff", "--patch", "--format", "json", "--color", "never")
	cmd.Stdin = strings.NewReader(string(unified))
	output, err := cmd.Output()
	if err != nil {
		return Report{}, false
	}

	report, err := parseSemanticReport(output)
	if err != nil {
		return Report{}, false
	}
	return report, true
}

// parseSemanticReport turns sem's JSON into the route shape. Split out so it can
// be tested without a sem binary on the machine.
func parseSemanticReport(output []byte) (Report, error) {
	var payload struct {
		Summary SemanticSummary `json:"summary"`
		Changes []struct {
			FilePath      string  `json:"filePath"`
			EntityType    string  `json:"entityType"`
			EntityName    string  `json:"entityName"`
			ChangeType    string  `json:"changeType"`
			StartLine     int     `json:"startLine"`
			EndLine       int     `json:"endLine"`
			OldStartLine  *int    `json:"oldStartLine"`
			OldEndLine    *int    `json:"oldEndLine"`
			OldEntityName *string `json:"oldEntityName"`
			OldFilePath   *string `json:"oldFilePath"`
			BeforeContent string  `json:"beforeContent"`
			AfterContent  string  `json:"afterContent"`
			// sem emits true, false, or null; null means "no prior entity"
			// (added/deleted), which is not a cosmetic change.
			StructuralChange *bool `json:"structuralChange"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(output, &payload); err != nil {
		return Report{}, err
	}

	changes := make(map[string][]SemanticChange)
	retainedContent := 0
	for _, change := range payload.Changes {
		if change.FilePath == "" {
			continue
		}
		item := SemanticChange{
			ChangeType: change.ChangeType,
			EntityType: change.EntityType,
			EntityName: change.EntityName,
			StartLine:  change.StartLine,
			EndLine:    change.EndLine,
			Cosmetic:   change.StructuralChange != nil && !*change.StructuralChange,
		}
		if change.OldStartLine != nil {
			item.OldStartLine = *change.OldStartLine
		}
		if change.OldEndLine != nil {
			item.OldEndLine = *change.OldEndLine
		}
		if change.OldEntityName != nil {
			item.OldEntityName = *change.OldEntityName
		}
		if change.OldFilePath != nil {
			item.OldFilePath = *change.OldFilePath
		}
		if canRetainContent(change.ChangeType, change.BeforeContent, change.AfterContent, retainedContent) {
			item.before = change.BeforeContent
			item.after = change.AfterContent
			retainedContent += len(change.BeforeContent) + len(change.AfterContent)
		}
		changes[change.FilePath] = append(changes[change.FilePath], item)
	}
	return Report{Changes: changes, Summary: payload.Summary}, nil
}

const (
	maxSemanticEntityBytes = 8 << 10
	maxSemanticContent     = 2 << 20
)

// canRetainContent bounds the entity bodies kept in memory for rewrite
// detection. Added and deleted entities have no pair to compare, and a
// pathological report must not hold the entire diff twice.
func canRetainContent(changeType, before, after string, retained int) bool {
	if changeType != "modified" || before == "" || after == "" {
		return false
	}
	size := len(before) + len(after)
	return size <= maxSemanticEntityBytes && retained+size <= maxSemanticContent
}

func diffHeaderPath(header string) string {
	if index := strings.Index(header, " b/"); index >= 0 {
		return cleanPath("b/" + header[index+3:])
	}
	parts := strings.Fields(header)
	if len(parts) == 2 {
		return cleanPath(parts[1])
	}
	return ""
}

func cleanPath(raw string) string {
	path := strings.TrimSpace(raw)
	if index := strings.IndexByte(path, '\t'); index >= 0 {
		path = path[:index]
	}
	if path == "/dev/null" || path == "" {
		return ""
	}
	if strings.HasPrefix(path, `"`) && strings.HasSuffix(path, `"`) {
		var unquoted string
		if err := json.Unmarshal([]byte(path), &unquoted); err == nil {
			path = unquoted
		}
	}
	path = strings.TrimPrefix(path, "a/")
	path = strings.TrimPrefix(path, "b/")
	return path
}
