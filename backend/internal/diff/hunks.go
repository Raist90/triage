package diff

import (
	"regexp"
	"strings"
)

// Span is one run of text inside a diff line. Emph marks the words that changed
// inside a paired removal/addition; the UI tints them more strongly than the
// rest of the line.
type Span struct {
	Text string `json:"text"`
	Kind string `json:"kind,omitempty" enum:"keyword,string,number,comment,type,func,variable,tag,property,builtin" doc:"Syntax category used for coloring"`
	Emph bool   `json:"emph,omitempty"`
}

// Line is one rendered row of a hunk. OldNumber and NewNumber are zero when the
// line does not exist on that side.
type Line struct {
	Kind      string `json:"kind" enum:"context,add,del" doc:"Row kind in the unified diff"`
	OldNumber int    `json:"oldNumber,omitempty"`
	NewNumber int    `json:"newNumber,omitempty"`
	Text      string `json:"text"`
	Spans     []Span `json:"spans,omitempty"`
}

// Hunk is one @@ block with line numbers and optionally word-level emphasis.
type Hunk struct {
	Header   string `json:"header"`
	Section  string `json:"section,omitempty"`
	OldStart int    `json:"oldStart"`
	OldCount int    `json:"oldCount"`
	NewStart int    `json:"newStart"`
	NewCount int    `json:"newCount"`
	Lines    []Line `json:"lines"`
}

var hunkHeader = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$`)

// HunkTailLine resolves the last content line of a GitHub diff_hunk: the line a
// review comment points at. Pending-review comments come back with line and
// side null, but their diff_hunk still ends on the commented line. The returned
// kind is "context", "add" or "del"; only the side that exists is numbered.
func HunkTailLine(diffHunk string) (kind string, oldNumber, newNumber int, ok bool) {
	lines := strings.Split(strings.ReplaceAll(diffHunk, "\r\n", "\n"), "\n")
	header := -1
	oldStart, newStart := 0, 0
	for index, raw := range lines {
		match := hunkHeader.FindStringSubmatch(raw)
		if match == nil {
			continue
		}
		header = index
		oldStart, newStart = atoi(match[1]), atoi(match[3])
	}
	if header < 0 {
		return "", 0, 0, false
	}

	oldLine, newLine := oldStart, newStart
	for _, raw := range lines[header+1:] {
		if raw == "" {
			continue
		}
		switch raw[0] {
		case ' ':
			kind, oldNumber, newNumber = "context", oldLine, newLine
			oldLine++
			newLine++
		case '-':
			kind, oldNumber, newNumber = "del", oldLine, 0
			oldLine++
		case '+':
			kind, oldNumber, newNumber = "add", 0, newLine
			newLine++
		case '\\':
			continue
		default:
			continue
		}
		ok = true
	}
	return kind, oldNumber, newNumber, ok
}

// BuildHunksFor builds hunks with an emphasis strategy suited to the file.
// It returns nil when the patch has no parseable hunk, so callers fall back to
// the raw text. Markup reformats one removed line into several added ones, so
// those files get block-level matching; code keeps positional pairing, which is
// precise for ordinary line edits.
func BuildHunksFor(path, patch string) []Hunk {
	return buildHunks(patch, isMarkup(path))
}

var markupExtensions = map[string]struct{}{
	"vue": {}, "html": {}, "htm": {}, "svelte": {},
}

func isMarkup(path string) bool {
	base := path
	if slash := strings.LastIndexAny(base, "/\\"); slash >= 0 {
		base = base[slash+1:]
	}
	dot := strings.LastIndexByte(base, '.')
	if dot < 0 || dot == len(base)-1 {
		return false
	}
	_, ok := markupExtensions[strings.ToLower(base[dot+1:])]
	return ok
}

func buildHunks(patch string, blockEmphasis bool) []Hunk {
	lines := strings.Split(strings.ReplaceAll(patch, "\r\n", "\n"), "\n")
	hunks := make([]Hunk, 0, 1)
	var current *Hunk
	oldNumber, newNumber := 0, 0

	for _, raw := range lines {
		if strings.HasPrefix(raw, "diff --git ") {
			current = nil
			continue
		}
		if current == nil && (strings.HasPrefix(raw, "--- ") ||
			strings.HasPrefix(raw, "+++ ") || strings.HasPrefix(raw, "index ")) {
			continue
		}

		if match := hunkHeader.FindStringSubmatch(raw); match != nil {
			oldStart := atoi(match[1])
			oldCount := count(match[2])
			newStart := atoi(match[3])
			newCount := count(match[4])
			hunks = append(hunks, Hunk{
				Header:   raw,
				Section:  strings.TrimSpace(match[5]),
				OldStart: oldStart,
				OldCount: oldCount,
				NewStart: newStart,
				NewCount: newCount,
				Lines:    make([]Line, 0, oldCount+newCount),
			})
			current = &hunks[len(hunks)-1]
			oldNumber, newNumber = oldStart, newStart
			continue
		}

		if current == nil || raw == "" {
			continue
		}

		switch raw[0] {
		case ' ':
			current.Lines = append(current.Lines, Line{
				Kind:      "context",
				OldNumber: oldNumber,
				NewNumber: newNumber,
				Text:      raw[1:],
			})
			oldNumber++
			newNumber++
		case '-':
			current.Lines = append(current.Lines, Line{
				Kind:      "del",
				OldNumber: oldNumber,
				Text:      raw[1:],
			})
			oldNumber++
		case '+':
			current.Lines = append(current.Lines, Line{
				Kind:      "add",
				NewNumber: newNumber,
				Text:      raw[1:],
			})
			newNumber++
		case '\\':
			// "\ No newline at end of file" belongs to no side.
		default:
			// Unknown line inside a hunk; keep it visible on both sides
			// rather than dropping content.
			current.Lines = append(current.Lines, Line{
				Kind:      "context",
				OldNumber: oldNumber,
				NewNumber: newNumber,
				Text:      raw,
			})
			oldNumber++
			newNumber++
		}
	}

	if len(hunks) == 0 {
		return nil
	}
	for index := range hunks {
		annotateEmphasis(&hunks[index], blockEmphasis)
	}
	return hunks
}

// annotateEmphasis pairs each run of removals with the additions that follow
// them and marks the tokens that actually differ. Code is paired line by line;
// markup is compared as one block so reformatted lines still match.
func annotateEmphasis(hunk *Hunk, block bool) {
	lines := hunk.Lines
	for index := 0; index < len(lines); {
		if lines[index].Kind != "del" {
			index++
			continue
		}
		delStart := index
		for index < len(lines) && lines[index].Kind == "del" {
			index++
		}
		addStart := index
		for index < len(lines) && lines[index].Kind == "add" {
			index++
		}
		dels, adds := lines[delStart:addStart], lines[addStart:index]
		if block {
			emphasizeBlock(dels, adds)
		} else {
			emphasizePairs(dels, adds)
		}
	}
}
