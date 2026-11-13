// Package omnidiff shells out to the omnidiff CLI to paint which bytes changed
// inside a pair of files. The CLI is optional: a missing binary degrades the
// Omnidiff tab to a hint, never a failed request.
package omnidiff

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	commandTimeout = 10 * time.Second
	versionTimeout = 2 * time.Second
	maxOutputBytes = 2 << 20
)

// Span kinds are the paint the terminal asked for. The webview maps them onto
// its own tokens; no ANSI sequence ever reaches the frontend.
const (
	SpanPlain  = "plain"
	SpanAdd    = "add"
	SpanDel    = "del"
	SpanChange = "change"
	SpanDim    = "dim"
	SpanStrong = "strong"
)

// Line kinds describe what a rendered line is, for the gutter and tint.
const (
	LineContext = "context"
	LineAdd     = "add"
	LineDel     = "del"
	LineChange  = "change"
	LineMeta    = "meta"
	LineSummary = "summary"
)

// Span is one run of text with a single paint.
type Span struct {
	Text string `json:"text"`
	Kind string `json:"kind"`
}

// Line is one rendered line of omnidiff's headless output.
type Line struct {
	Kind  string `json:"kind"`
	Spans []Span `json:"spans"`
}

// Section is one side of the rendered diff. OmniDiff prints the before block
// first, then the after block.
type Section struct {
	Side  string `json:"side"`
	Path  string `json:"path"`
	Lines []Line `json:"lines"`
}

// Result is one parsed headless diff.
type Result struct {
	// Summary holds pre-section lines such as "New file - everything inserted".
	Summary  []Line    `json:"summary,omitempty"`
	Sections []Section `json:"sections"`
}

// Available reports whether the CLI is on PATH.
func Available() bool {
	_, err := exec.LookPath("omnidiff")
	return err == nil
}

var (
	versionOnce sync.Once
	version     string
)

// Version is the CLI version, used in cache keys. "missing" and "unknown" are
// stable fallbacks so a broken CLI never disables the cache entirely.
func Version() string {
	versionOnce.Do(func() {
		binary, err := exec.LookPath("omnidiff")
		if err != nil {
			version = "missing"
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), versionTimeout)
		defer cancel()
		out, err := exec.CommandContext(ctx, binary, "--version").Output()
		if err != nil {
			version = "unknown"
			return
		}
		version = strings.TrimSpace(string(out))
	})
	return version
}

// Run diffs two files with omnidiff's headless renderer. Color is forced so the
// output does not depend on the sidecar's environment.
func Run(ctx context.Context, before, after string) (Result, error) {
	binary, err := exec.LookPath("omnidiff")
	if err != nil {
		return Result{}, errors.New("omnidiff not found")
	}

	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, binary, "--headless", "--color", "always", before, after)
	// Deterministic paint: no NO_COLOR, no truecolor detection. The parser maps
	// the basic palette to tokens.
	env := make([]string, 0, len(os.Environ())+1)
	for _, item := range os.Environ() {
		if strings.HasPrefix(item, "NO_COLOR=") || strings.HasPrefix(item, "COLORTERM=") {
			continue
		}
		env = append(env, item)
	}
	cmd.Env = append(env, "TERM=xterm-256color")

	out, err := cmd.Output()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Result{}, errors.New("omnidiff timed out")
		}
		return Result{}, errors.New("omnidiff failed")
	}
	return Parse(out), nil
}

// Parse turns headless output into sections and lines. Malformed or unexpected
// input degrades to plain spans; it never panics.
func Parse(data []byte) Result {
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	text = strings.TrimSuffix(text, "\n")

	result := Result{Sections: []Section{}}
	current := -1
	written := 0

	for _, raw := range strings.Split(text, "\n") {
		if written >= maxOutputBytes {
			result.AppendLine(Line{
				Kind: LineMeta,
				Spans: []Span{{
					Text: "… output truncated by Triage …",
					Kind: SpanDim,
				}},
			})
			break
		}

		spans := parseLine(raw)
		if side, path, ok := header(spans); ok {
			result.Sections = append(result.Sections, Section{
				Side:  side,
				Path:  path,
				Lines: []Line{},
			})
			current = len(result.Sections) - 1
			continue
		}

		line := Line{Kind: classify(spans), Spans: spans}
		written += len(lineText(line))
		if current < 0 {
			result.Summary = append(result.Summary, line)
			continue
		}
		result.Sections[current].Lines = append(result.Sections[current].Lines, line)
	}

	return result
}

// AppendLine adds a line after the last section, so Callers can append a
// truncation notice without knowing the section layout.
func (r *Result) AppendLine(line Line) {
	if len(r.Sections) == 0 {
		r.Summary = append(r.Summary, line)
		return
	}
	last := len(r.Sections) - 1
	r.Sections[last].Lines = append(r.Sections[last].Lines, line)
}

func lineText(line Line) string {
	var builder strings.Builder
	for _, span := range line.Spans {
		builder.WriteString(span.Text)
	}
	return builder.String()
}

// header recognises omnidiff's "=== before: path ===" side markers.
func header(spans []Span) (side, path string, ok bool) {
	text := strings.TrimSpace(lineText(Line{Spans: spans}))
	if !strings.HasPrefix(text, "===") || !strings.HasSuffix(text, "===") {
		return "", "", false
	}
	inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(text, "==="), "==="))
	switch {
	case strings.HasPrefix(inner, "before:"):
		return "before", strings.TrimSpace(strings.TrimPrefix(inner, "before:")), true
	case strings.HasPrefix(inner, "after:"):
		return "after", strings.TrimSpace(strings.TrimPrefix(inner, "after:")), true
	default:
		return "", "", false
	}
}

// classify names a rendered line from its spans. The marker a reader sees is a
// span that holds just "-", "+" or "~".
func classify(spans []Span) string {
	onlyDim := true
	onlyStrong := true
	for _, span := range spans {
		trimmed := strings.TrimSpace(span.Text)
		if trimmed == "" {
			continue
		}
		switch trimmed {
		case "-":
			return LineDel
		case "+":
			return LineAdd
		case "~":
			return LineChange
		}
		if span.Kind != SpanDim {
			onlyDim = false
		}
		if span.Kind != SpanStrong {
			onlyStrong = false
		}
	}
	if onlyDim {
		return LineMeta
	}
	if onlyStrong {
		return LineSummary
	}
	return LineContext
}

// parseLine walks one line of ANSI text and emits spans. Unknown sequences drop
// their paint but keep their text.
func parseLine(raw string) []Span {
	spans := make([]Span, 0, 8)
	kind := SpanPlain
	var run strings.Builder

	flush := func() {
		if run.Len() == 0 {
			return
		}
		spans = append(spans, Span{Text: run.String(), Kind: kind})
		run.Reset()
	}

	for index := 0; index < len(raw); {
		if raw[index] == 0x1b && index+1 < len(raw) && raw[index+1] == '[' {
			end := index + 2
			for end < len(raw) && raw[end] != 'm' {
				end++
			}
			if end < len(raw) {
				flush()
				kind = paint(raw[index+2 : end])
				index = end + 1
				continue
			}
		}
		run.WriteByte(raw[index])
		index++
	}
	flush()

	if len(spans) == 0 {
		return []Span{{Text: "", Kind: SpanPlain}}
	}
	return spans
}

// paint maps one SGR parameter list to a span kind. Later parameters win, which
// matches how a terminal applies them.
func paint(params string) string {
	kind := SpanPlain
	fields := strings.Split(params, ";")
	for index := 0; index < len(fields); index++ {
		code, err := strconv.Atoi(fields[index])
		if err != nil {
			continue
		}
		switch {
		case code == 0:
			kind = SpanPlain
		case code == 1:
			kind = SpanStrong
		case code == 22:
			kind = SpanPlain
		case code == 31 || code == 91:
			kind = SpanDel
		case code == 32 || code == 92:
			kind = SpanAdd
		case code == 33 || code == 93:
			kind = SpanChange
		case code == 90:
			kind = SpanDim
		case code >= 30 && code <= 37:
			kind = SpanPlain
		case code == 38:
			// 38;5;N or 38;2;r;g;b. Consume the payload and classify by hue.
			switch {
			case index+2 < len(fields) && fields[index+1] == "5":
				if value, convErr := strconv.Atoi(fields[index+2]); convErr == nil {
					kind = indexedPaint(value)
				}
				index += 2
			case index+4 < len(fields) && fields[index+1] == "2":
				red, redErr := strconv.Atoi(fields[index+2])
				green, greenErr := strconv.Atoi(fields[index+3])
				blue, blueErr := strconv.Atoi(fields[index+4])
				if redErr == nil && greenErr == nil && blueErr == nil {
					kind = rgbPaint(red, green, blue)
				}
				index += 4
			}
		}
	}
	return kind
}

// indexedPaint classifies the 256-colour palette by hue. Only the six primary
// cube colours and the greys matter; everything else stays plain.
func indexedPaint(value int) string {
	if value < 16 {
		switch value {
		case 1, 9:
			return SpanDel
		case 2, 10:
			return SpanAdd
		case 3, 11:
			return SpanChange
		case 8:
			return SpanDim
		default:
			return SpanPlain
		}
	}
	if value >= 232 {
		return SpanDim
	}
	offset := value - 16
	steps := [6]int{0, 95, 135, 175, 215, 255}
	red := steps[offset/36]
	green := steps[(offset/6)%6]
	blue := steps[offset%6]
	return rgbPaint(red, green, blue)
}

func rgbPaint(red, green, blue int) string {
	const threshold = 60
	// Orange sits between red and yellow. Only a clearly red-dominant colour is
	// a deletion; orange is the "changed" paint.
	if red > green+2*threshold && red > blue+threshold {
		return SpanDel
	}
	if green > red+threshold && green > blue+threshold {
		return SpanAdd
	}
	if red > blue+threshold && green > blue+threshold {
		return SpanChange
	}
	if red < 100 && green < 100 && blue < 100 {
		return SpanDim
	}
	return SpanPlain
}
