package diff

import "strings"

// File kinds drive both the sidebar filters and the review-priority weights.
// They live here so the frontend and the scoring use the same classification.
const (
	KindTest      = "test"
	KindDocs      = "docs"
	KindGenerated = "generated"
)

var lockfiles = map[string]struct{}{
	"package-lock.json": {},
	"bun.lockb":         {},
	"bun.lock":          {},
	"yarn.lock":         {},
	"pnpm-lock.yaml":    {},
	"go.sum":            {},
	"cargo.lock":        {},
	"poetry.lock":       {},
	"composer.lock":     {},
	"gemfile.lock":      {},
}

var testSegments = map[string]struct{}{
	"test": {}, "tests": {}, "__tests__": {}, "testdata": {},
	"__snapshots__": {}, "cypress": {}, "e2e": {},
}

var generatedSegments = map[string]struct{}{
	"vendor": {}, "node_modules": {}, "dist": {}, "build": {}, "generated": {},
}

var docsSegments = map[string]struct{}{"docs": {}}

// Kinds classifies a path the same way the diff sidebar always has. It matches
// the new path only, and returns an empty slice for ordinary source files.
func Kinds(path string) []string {
	lower := strings.ToLower(path)
	base := lower
	if slash := strings.LastIndexByte(lower, '/'); slash >= 0 {
		base = lower[slash+1:]
	}
	segments := strings.Split(lower, "/")

	kinds := make([]string, 0, 2)
	if strings.HasSuffix(base, "_test.go") ||
		isTestFile(base) ||
		strings.HasSuffix(base, ".snap") ||
		hasSegment(segments, testSegments) {
		kinds = append(kinds, KindTest)
	}
	if strings.HasSuffix(base, ".md") ||
		strings.HasSuffix(base, ".mdx") ||
		hasSegment(segments, docsSegments) ||
		strings.HasPrefix(base, "license") ||
		strings.HasPrefix(base, "changelog") {
		kinds = append(kinds, KindDocs)
	}
	if isGenerated(base, segments) {
		kinds = append(kinds, KindGenerated)
	}
	return kinds
}

func isTestFile(base string) bool {
	for _, ext := range []string{".test.", ".spec."} {
		if strings.Contains(base, ext) {
			return true
		}
	}
	return false
}

func isGenerated(base string, segments []string) bool {
	if _, ok := lockfiles[base]; ok {
		return true
	}
	return strings.HasSuffix(base, ".lock") ||
		strings.Contains(base, ".min.") ||
		strings.HasSuffix(base, ".map") ||
		hasSegment(segments, generatedSegments)
}

func hasSegment(segments []string, set map[string]struct{}) bool {
	for _, segment := range segments {
		if _, ok := set[segment]; ok {
			return true
		}
	}
	return false
}
