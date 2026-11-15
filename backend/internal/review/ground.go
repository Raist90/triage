package review

import (
	"strings"

	"github.com/Raist90/triage/backend/internal/diff"
)

// groundIndex resolves a finding against the diff and sem's entity changes. The
// model may quote a line from a file, entity or context the pull request never
// changed; grounding turns that into a hidden finding instead of a confident
// snippet.
type groundIndex struct {
	files map[string]*groundFile
}

type groundFile struct {
	Path     string
	NewLines map[int]string
	OldLines map[int]string
	entities map[string]diff.SemanticChange
}

func buildGroundIndex(files []diff.File) *groundIndex {
	index := &groundIndex{files: make(map[string]*groundFile, len(files)*2)}
	for _, file := range files {
		ground := newGroundFile(file)
		if path := normalizeFindingPath(file.Path); path != "" {
			index.files[path] = ground
		}
		if path := normalizeFindingPath(file.OldPath); path != "" {
			index.files[path] = ground
		}
	}
	return index
}

func newGroundFile(file diff.File) *groundFile {
	hunks := file.Hunks
	if len(hunks) == 0 {
		hunks = diff.BuildHunksFor(file.Path, file.Patch)
	}
	ground := &groundFile{
		Path:     file.Path,
		NewLines: make(map[int]string),
		OldLines: make(map[int]string),
		entities: make(map[string]diff.SemanticChange),
	}
	for _, hunk := range hunks {
		for _, line := range hunk.Lines {
			// Only added and deleted lines are evidence. A context line inside a
			// hunk is still unchanged code, and quoting it would let a finding
			// anchor to code the pull request did not change.
			text := normalizeWhitespace(line.Text)
			switch line.Kind {
			case "add":
				if line.NewNumber > 0 {
					ground.NewLines[line.NewNumber] = text
				}
			case "del":
				if line.OldNumber > 0 {
					ground.OldLines[line.OldNumber] = text
				}
			}
		}
	}
	for _, change := range file.Semantic {
		name := normalizeEntityName(change.EntityName)
		if name == "" {
			continue
		}
		if _, exists := ground.entities[name]; exists {
			continue
		}
		ground.entities[name] = change
	}
	return ground
}

// ground resolves the finding's evidence to a changed line. The returned reason
// is empty on success and one of the reason constants otherwise.
func (g *groundIndex) ground(finding Finding) (Finding, string) {
	file, ok := g.files[normalizeFindingPath(finding.File)]
	if !ok {
		return finding, reasonFileNotChanged
	}
	evidence := normalizeWhitespace(finding.Evidence)
	if evidence == "" {
		return finding, reasonNoEvidence
	}

	line, ok := findEvidenceLine(file, evidence, 0, 0)
	if !ok {
		return finding, reasonEvidenceNotChanged
	}

	// The entity is a hint, not the anchor. Evidence already resolved to a
	// changed line, so a wrong or unknown entity clears the label instead of
	// hiding a correctly anchored finding.
	if raw := strings.TrimSpace(finding.Entity); raw != "" {
		finding.Entity = ""
		if change, found := file.lookupEntity(raw); found {
			start, end := changeRange(change)
			if start > 0 {
				if contained, ok := findEvidenceLine(file, evidence, start, end); ok {
					line = contained
					finding.Entity = change.EntityName
				}
			}
		}
	}

	finding.File = file.Path
	finding.Line = line
	finding.EndLine = 0
	return finding, ""
}

func findEvidenceLine(file *groundFile, evidence string, start, end int) (int, bool) {
	if line, ok := matchLine(file.NewLines, evidence, start, end); ok {
		return line, true
	}
	return matchLine(file.OldLines, evidence, start, end)
}

// matchLine returns the lowest matching line inside the optional range. File
// order is the tie-breaker, so duplicate lines resolve the same way every run.
func matchLine(lines map[int]string, evidence string, start, end int) (int, bool) {
	best := 0
	for number, text := range lines {
		if text != evidence {
			continue
		}
		if start > 0 && (number < start || number > end) {
			continue
		}
		if best == 0 || number < best {
			best = number
		}
	}
	return best, best != 0
}

func changeRange(change diff.SemanticChange) (int, int) {
	if change.StartLine > 0 {
		end := change.EndLine
		if end < change.StartLine {
			end = change.StartLine
		}
		return change.StartLine, end
	}
	if change.OldStartLine > 0 {
		end := change.OldEndLine
		if end < change.OldStartLine {
			end = change.OldStartLine
		}
		return change.OldStartLine, end
	}
	return 0, 0
}

func (f *groundFile) lookupEntity(raw string) (diff.SemanticChange, bool) {
	for _, candidate := range entityCandidates(raw) {
		if change, ok := f.entities[normalizeEntityName(candidate)]; ok {
			return change, true
		}
	}
	return diff.SemanticChange{}, false
}

func normalizeEntityName(name string) string {
	return strings.ToLower(strings.TrimSpace(strings.Trim(name, "`")))
}

// entityCandidates handles models that join several entity names in one string,
// such as "configView / repoReview". The full string is tried first.
func entityCandidates(raw string) []string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil
	}
	seen := make(map[string]bool)
	out := make([]string, 0, 4)
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		key := normalizeEntityName(name)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, name)
	}
	add(value)
	for _, separator := range []string{" / ", " · ", ",", "/"} {
		if !strings.Contains(value, separator) {
			continue
		}
		for _, part := range strings.Split(value, separator) {
			add(part)
		}
	}
	return out
}
