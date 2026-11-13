package diff

import (
	"regexp"
	"strconv"
	"strings"
)

// Span is one run of text inside a diff line. Emph marks the words that changed
// inside a paired removal/addition; the UI tints them more strongly than the
// rest of the line.
type Span struct {
	Text string `json:"text"`
	Kind string `json:"kind,omitempty"`
	Emph bool   `json:"emph,omitempty"`
}

// Line is one rendered row of a hunk. OldNumber and NewNumber are zero when the
// line does not exist on that side.
type Line struct {
	Kind      string `json:"kind"`
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

// BuildHunks turns one file's patch into structured rows. It returns nil when
// the patch has no parseable hunk, so callers fall back to the raw text.
// Emphasis pairs lines by position; use BuildHunksFor to pick the strategy
// from the file type.
func BuildHunks(patch string) []Hunk {
	return buildHunks(patch, false)
}

// BuildHunksFor builds hunks with an emphasis strategy suited to the file.
// Markup reformats one removed line into several added ones, so those files get
// block-level matching; code keeps positional pairing, which is precise for
// ordinary line edits.
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

const (
	maxEmphasisRunes  = 2000
	maxEmphasisTokens = 400

	// Block-level matching sees every removed and added line at once, so it
	// needs looser caps than a single pair.
	maxBlockEmphasisRunes  = 4000
	maxBlockEmphasisTokens = 600

	minSimilarity    = 0.4
	maxEmphasisShare = 0.6
)

// emphasizeBlock marks the tokens that differ between a run of removals and
// the run of additions that follows it. Oversized blocks fall back to
// positional pairing so a pathological diff cannot blow up the LCS table.
func emphasizeBlock(dels, adds []Line) {
	if len(dels) == 0 || len(adds) == 0 {
		return
	}
	if blockRunes(dels)+blockRunes(adds) > maxBlockEmphasisRunes {
		emphasizePairs(dels, adds)
		return
	}

	delTokens := make([][]string, len(dels))
	addTokens := make([][]string, len(adds))
	flatDel := make([]string, 0, len(dels)*8)
	flatAdd := make([]string, 0, len(adds)*8)
	for index, line := range dels {
		delTokens[index] = tokenize(line.Text)
		flatDel = append(flatDel, delTokens[index]...)
	}
	for index, line := range adds {
		addTokens[index] = tokenize(line.Text)
		flatAdd = append(flatAdd, addTokens[index]...)
	}
	if len(flatDel) > maxBlockEmphasisTokens || len(flatAdd) > maxBlockEmphasisTokens {
		emphasizePairs(dels, adds)
		return
	}

	keepDel, keepAdd := commonTokens(flatDel, flatAdd)
	// A block whose tokens barely overlap is a rewrite, not an edit; leave the
	// line tints alone instead of scattering emphasis across unrelated code.
	if blockShare(dels, delTokens, keepDel) > maxEmphasisShare ||
		blockShare(adds, addTokens, keepAdd) > maxEmphasisShare {
		return
	}
	applyEmphasis(dels, delTokens, keepDel)
	applyEmphasis(adds, addTokens, keepAdd)
}

// emphasizePairs pairs removals and additions by position.
func emphasizePairs(dels, adds []Line) {
	for offset := 0; offset < len(dels) && offset < len(adds); offset++ {
		emphasizePair(&dels[offset], &adds[offset])
	}
}

func blockRunes(lines []Line) int {
	total := 0
	for _, line := range lines {
		total += len([]rune(line.Text))
	}
	return total
}

// blockShare is the fraction of runes in a block whose tokens were not kept.
func blockShare(lines []Line, tokens [][]string, keep []bool) float64 {
	total, changed := blockRunes(lines), 0
	position := 0
	for _, lineTokens := range tokens {
		for _, token := range lineTokens {
			if position < len(keep) && !keep[position] {
				changed += len([]rune(token))
			}
			position++
		}
	}
	if total == 0 {
		return 0
	}
	return float64(changed) / float64(total)
}

// applyEmphasis turns the kept-token flags back into per-line spans.
func applyEmphasis(lines []Line, tokens [][]string, keep []bool) {
	offset := 0
	for index := range lines {
		count := len(tokens[index])
		spans := buildSpans(tokens[index], keep[offset:offset+count])
		offset += count
		if spans == nil {
			continue
		}
		if emphasisShare(spans, lines[index].Text) > maxEmphasisShare {
			continue
		}
		lines[index].Spans = spans
	}
}

// emphasizePair marks differing tokens on a removal/addition pair. Heavy
// rewrites are left with only the whole-line tint so the diff does not turn
// into confetti.
func emphasizePair(del, add *Line) {
	if len([]rune(del.Text))+len([]rune(add.Text)) > maxEmphasisRunes {
		return
	}
	delTokens := tokenize(del.Text)
	addTokens := tokenize(add.Text)
	if len(delTokens) > maxEmphasisTokens || len(addTokens) > maxEmphasisTokens {
		return
	}

	keepDel, keepAdd := commonTokens(delTokens, addTokens)
	if similarity(del.Text, add.Text) < minSimilarity {
		return
	}
	delSpans := buildSpans(delTokens, keepDel)
	addSpans := buildSpans(addTokens, keepAdd)
	if emphasisShare(delSpans, del.Text) > maxEmphasisShare ||
		emphasisShare(addSpans, add.Text) > maxEmphasisShare {
		return
	}
	del.Spans, add.Spans = delSpans, addSpans
}

// emphasisShare is the fraction of a line covered by emphasized spans.
func emphasisShare(spans []Span, text string) float64 {
	total := len([]rune(text))
	if total == 0 {
		return 0
	}
	emphasized := 0
	for _, span := range spans {
		if span.Emph {
			emphasized += len([]rune(span.Text))
		}
	}
	return float64(emphasized) / float64(total)
}

// tokenize splits text into runs of word characters, whitespace runs, and
// single punctuation characters. Punctuation is split so an operator change
// highlights alone instead of swallowing the rest of the line.
func tokenize(text string) []string {
	tokens := make([]string, 0, len(text)/3)
	var current strings.Builder
	currentKind := runeKind(0)
	for _, r := range text {
		kind := runeKind(r)
		if kind != currentKind || kind == kindPunct {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			currentKind = kind
		}
		current.WriteRune(r)
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

const (
	kindNone = iota
	kindWord
	kindSpace
	kindPunct
)

func runeKind(r rune) int {
	switch {
	case r == 0:
		return kindNone
	case r == ' ' || r == '\t':
		return kindSpace
	case r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
		return kindWord
	default:
		return kindPunct
	}
}

// commonTokens runs an LCS over the two token slices and reports which tokens
// survive on each side.
func commonTokens(a, b []string) ([]bool, []bool) {
	keepA := make([]bool, len(a))
	keepB := make([]bool, len(b))

	prefix := 0
	for prefix < len(a) && prefix < len(b) && a[prefix] == b[prefix] {
		keepA[prefix], keepB[prefix] = true, true
		prefix++
	}
	suffix := 0
	for suffix < len(a)-prefix && suffix < len(b)-prefix &&
		a[len(a)-1-suffix] == b[len(b)-1-suffix] {
		keepA[len(a)-1-suffix], keepB[len(b)-1-suffix] = true, true
		suffix++
	}

	middleA := a[prefix : len(a)-suffix]
	middleB := b[prefix : len(b)-suffix]
	if len(middleA) == 0 || len(middleB) == 0 {
		return keepA, keepB
	}

	table := make([][]int, len(middleA)+1)
	for i := range table {
		table[i] = make([]int, len(middleB)+1)
	}
	for i := 1; i <= len(middleA); i++ {
		for j := 1; j <= len(middleB); j++ {
			if middleA[i-1] == middleB[j-1] {
				table[i][j] = table[i-1][j-1] + 1
			} else if table[i-1][j] >= table[i][j-1] {
				table[i][j] = table[i-1][j]
			} else {
				table[i][j] = table[i][j-1]
			}
		}
	}
	i, j := len(middleA), len(middleB)
	for i > 0 && j > 0 {
		switch {
		case middleA[i-1] == middleB[j-1]:
			keepA[prefix+i-1], keepB[prefix+j-1] = true, true
			i--
			j--
		case table[i-1][j] >= table[i][j-1]:
			i--
		default:
			j--
		}
	}
	return keepA, keepB
}

// buildSpans merges adjacent tokens with the same emphasis flag. It returns nil
// when nothing differs, so the caller can render the plain line text.
func buildSpans(tokens []string, keep []bool) []Span {
	spans := make([]Span, 0, 4)
	anyChanged := false
	for index, token := range tokens {
		changed := !keep[index]
		if changed {
			anyChanged = true
		}
		if len(spans) > 0 && spans[len(spans)-1].Emph == changed {
			spans[len(spans)-1].Text += token
			continue
		}
		spans = append(spans, Span{Text: token, Emph: changed})
	}
	if !anyChanged {
		return nil
	}
	return spans
}

// similarity is the share of runes the two lines have in common, used to skip
// emphasis on lines that were effectively rewritten.
func similarity(a, b string) float64 {
	ar, br := []rune(a), []rune(b)
	limit := len(ar)
	if len(br) < limit {
		limit = len(br)
	}
	common := 0
	for common < limit && ar[common] == br[common] {
		common++
	}
	suffix := 0
	for suffix < limit-common && ar[len(ar)-1-suffix] == br[len(br)-1-suffix] {
		suffix++
	}
	longest := len(ar)
	if len(br) > longest {
		longest = len(br)
	}
	if longest == 0 {
		return 1
	}
	return float64(common+suffix) / float64(longest)
}

func atoi(raw string) int {
	value, _ := strconv.Atoi(raw)
	return value
}

// count defaults to 1 when the hunk header omits the count, matching git.
func count(raw string) int {
	if raw == "" {
		return 1
	}
	return atoi(raw)
}
