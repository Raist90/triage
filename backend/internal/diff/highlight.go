package diff

import (
	"strings"
	"sync"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"
)

// Kind is the syntax role of a span. The UI maps each kind to a muted color;
// an empty kind means plain text.
const (
	KindKeyword  = "keyword"
	KindString   = "string"
	KindNumber   = "number"
	KindComment  = "comment"
	KindType     = "type"
	KindFunc     = "func"
	KindVariable = "variable"
	KindTag      = "tag"
	KindProperty = "property"
	KindBuiltin  = "builtin"
)

type syntaxPiece struct {
	text string
	kind string
}

// Highlight adds syntax kinds to hunk lines in place. It tokenizes each side of
// a hunk as one document so multi-line constructs inside a hunk keep their
// state. Only code languages are highlighted: markup lexers on hunk fragments
// produce noise. Unknown languages and lexer failures leave the line untouched.
func Highlight(path string, hunks []Hunk) {
	if !highlightable(path) {
		return
	}
	lexer := matchLexer(path)
	if lexer == nil {
		return
	}
	lexer = chroma.Coalesce(lexer)
	for index := range hunks {
		lines := hunks[index].Lines
		// Lex the old side for deleted lines, the new side for context and
		// added lines. Context is assigned once, from the new side, so the two
		// passes cannot overwrite each other.
		highlightSide(lexer, lines, keepDel, func(line Line) bool {
			return line.Kind == "del"
		})
		highlightSide(lexer, lines, keepNew, func(line Line) bool {
			return line.Kind != "del"
		})
	}
}

func matchLexer(path string) chroma.Lexer {
	if strings.HasSuffix(strings.ToLower(path), ".vue") {
		return vueLexer()
	}
	return lexers.Match(path)
}

var (
	vueLexerOnce  sync.Once
	vueLexerFixed chroma.Lexer
)

// vueLexer patches a Chroma lexer bug: its Vue rules only tokenize the "<!--"
// opener as a comment. An apostrophe inside an HTML comment then starts a JS
// string that swallows the rest of the hunk. Consume the whole comment instead,
// and treat an unclosed comment as running to the end of the hunk fragment.
func vueLexer() chroma.Lexer {
	vueLexerOnce.Do(func() {
		base := lexers.Get("vue")
		regex, ok := base.(*chroma.RegexLexer)
		if !ok {
			vueLexerFixed = base
			return
		}
		rules, err := regex.Rules()
		if err != nil {
			vueLexerFixed = base
			return
		}
		rules = rules.Clone()
		rules["commentsandwhitespace"] = append([]chroma.Rule{{
			Pattern: `<!--.*?(?:-->|\z)`,
			Type:    chroma.Comment,
		}}, rules["commentsandwhitespace"]...)
		config := *regex.Config()
		lexer, err := chroma.NewLexer(&config, func() chroma.Rules { return rules })
		if err != nil {
			vueLexerFixed = base
			return
		}
		vueLexerFixed = lexer
	})
	return vueLexerFixed
}

// highlightable limits highlighting to code files. Markup needs whole-file
// context (SFC regions, nested lexers) that a hunk fragment cannot provide.
// Vue is the exception: its lexer still tokenizes bare script and template
// fragments usefully, so .vue diffs do not fall back to plain text.
func highlightable(path string) bool {
	base := path
	if slash := strings.LastIndexAny(base, "/\\"); slash >= 0 {
		base = base[slash+1:]
	}
	switch base {
	case "Dockerfile", "Makefile", "Justfile":
		return true
	}
	dot := strings.LastIndexByte(base, '.')
	if dot < 0 || dot == len(base)-1 {
		return false
	}
	_, ok := highlightExtensions[strings.ToLower(base[dot+1:])]
	return ok
}

var highlightExtensions = map[string]struct{}{
	"bash": {}, "c": {}, "cc": {}, "cjs": {}, "cpp": {}, "cs": {},
	"css": {}, "go": {}, "gql": {}, "graphql": {}, "h": {}, "hpp": {},
	"java": {}, "js": {}, "json": {}, "jsx": {}, "kt": {}, "kts": {},
	"less": {}, "mjs": {}, "php": {}, "proto": {}, "py": {}, "rb": {},
	"rs": {}, "scss": {}, "sh": {}, "sql": {}, "swift": {}, "toml": {},
	"ts": {}, "tsx": {}, "vue": {}, "yaml": {}, "yml": {}, "zsh": {},
}

func keepDel(line Line) bool {
	return line.Kind != "add"
}

func keepNew(line Line) bool {
	return line.Kind != "del"
}

func highlightSide(lexer chroma.Lexer, lines []Line, include, assign func(Line) bool) {
	indices := make([]int, 0, len(lines))
	texts := make([]string, 0, len(lines))
	for index, line := range lines {
		if include(line) {
			indices = append(indices, index)
			texts = append(texts, line.Text)
		}
	}
	if len(texts) == 0 {
		return
	}

	tokens, err := chroma.Tokenise(lexer, nil, strings.Join(texts, "\n"))
	if err != nil {
		return
	}

	pieces := make([][]syntaxPiece, len(texts))
	line := 0
	for _, token := range tokens {
		if token.Value == "" {
			continue
		}
		kind := kindFor(token.Type)
		for partIndex, part := range strings.Split(token.Value, "\n") {
			if partIndex > 0 {
				line++
			}
			if line >= len(texts) {
				return
			}
			if part != "" {
				pieces[line] = append(pieces[line], syntaxPiece{text: part, kind: kind})
			}
		}
	}

	for offset, index := range indices {
		if assign(lines[index]) {
			lines[index].Spans = mergeSpans(lines[index], pieces[offset])
		}
	}
}

// mergeSpans combines syntax pieces with the emphasis already computed for the
// line, splitting them so both roles survive.
func mergeSpans(line Line, pieces []syntaxPiece) []Span {
	if len(pieces) == 0 {
		return line.Spans
	}
	if joinPieces(pieces) != line.Text {
		return line.Spans
	}

	emphasis := make([]bool, 0, len(line.Text))
	for _, span := range line.Spans {
		for range []rune(span.Text) {
			emphasis = append(emphasis, span.Emph)
		}
	}

	spans := make([]Span, 0, len(pieces))
	position := 0
	for _, piece := range pieces {
		for _, char := range piece.text {
			emph := position < len(emphasis) && emphasis[position]
			if len(spans) > 0 &&
				spans[len(spans)-1].Kind == piece.kind &&
				spans[len(spans)-1].Emph == emph {
				spans[len(spans)-1].Text += string(char)
			} else {
				spans = append(spans, Span{Text: string(char), Kind: piece.kind, Emph: emph})
			}
			position++
		}
	}
	return spans
}

func joinPieces(pieces []syntaxPiece) string {
	var builder strings.Builder
	for _, piece := range pieces {
		builder.WriteString(piece.text)
	}
	return builder.String()
}

func kindFor(tokenType chroma.TokenType) string {
	switch {
	case tokenType.InCategory(chroma.Comment):
		return KindComment
	case tokenType == chroma.NameClass, tokenType == chroma.NameNamespace,
		tokenType == chroma.NameException, tokenType == chroma.KeywordType:
		return KindType
	case tokenType == chroma.NameFunction, tokenType == chroma.NameFunctionMagic,
		tokenType == chroma.NameDecorator:
		return KindFunc
	case tokenType == chroma.NameTag:
		return KindTag
	case tokenType == chroma.NameAttribute, tokenType == chroma.NameProperty:
		return KindProperty
	case tokenType == chroma.NameBuiltin, tokenType == chroma.NameBuiltinPseudo,
		tokenType == chroma.NameConstant, tokenType == chroma.KeywordConstant:
		return KindBuiltin
	case tokenType.InCategory(chroma.NameVariable):
		return KindVariable
	case tokenType.InCategory(chroma.Keyword):
		return KindKeyword
	case tokenType.InSubCategory(chroma.LiteralString):
		return KindString
	case tokenType.InSubCategory(chroma.LiteralNumber):
		return KindNumber
	default:
		return ""
	}
}
