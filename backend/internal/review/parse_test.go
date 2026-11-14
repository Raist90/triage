package review

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/Raist90/triage/backend/internal/diff"
)

// A blank context line is one space in a unified diff. Building the patches by
// concatenation keeps that space out of this source file's line endings.
const checkoutPatch = "diff --git a/api/checkout.go b/api/checkout.go\n" +
	"index 1111111..2222222 100644\n" +
	"--- a/api/checkout.go\n" +
	"+++ b/api/checkout.go\n" +
	"@@ -1,3 +1,5 @@\n" +
	" package api\n" +
	" \n" +
	"+// Retry reuses the request key.\n" +
	"+// Keep the retry bounded.\n" +
	" func checkout() {}\n"

const deletedPatch = "diff --git a/api/checkout.go b/api/checkout.go\n" +
	"index 1111111..2222222 100644\n" +
	"--- a/api/checkout.go\n" +
	"+++ b/api/checkout.go\n" +
	"@@ -1,3 +1,2 @@\n" +
	" package api\n" +
	" \n" +
	"-func checkout() {}\n"

const (
	checkoutEvidence       = "// Retry reuses the request key."
	checkoutSecondEvidence = "// Keep the retry bounded."
)

const guidelinesFixture = `## AGENTS.md

Use Bun.
Do not add dependencies.
`

func fixtureFiles() []diff.File {
	return diff.Parse([]byte(checkoutPatch))
}

func fixtureGrounding() Grounding {
	return Grounding{Files: fixtureFiles(), Guidelines: guidelinesFixture}
}

func finding(severity Severity, title, evidence string) Finding {
	return Finding{
		Severity: severity,
		Category: CategoryRisk,
		Title:    title,
		Claim:    "claim",
		File:     "api/checkout.go",
		Evidence: evidence,
	}
}

func TestParseStructedOutputWins(t *testing.T) {
	structured := json.RawMessage(`{"verdict":{"safeToMerge":true,"summary":"ok"},"findings":[]}`)
	parsed, err := Parse(structured, `{"verdict":{"safeToMerge":false,"summary":"text"},"findings":[]}`)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !parsed.Verdict.SafeToMerge || parsed.Verdict.Summary != "ok" {
		t.Fatalf("parsed = %+v", parsed)
	}
}

func TestParseFencedResult(t *testing.T) {
	text := "Here is the review:\n```json\n{\"verdict\":{\"safeToMerge\":false,\"summary\":\"fix it\"},\"findings\":[]}\n```\n"
	parsed, err := Parse(nil, text)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if parsed.Verdict.SafeToMerge || parsed.Verdict.Summary != "fix it" {
		t.Fatalf("parsed = %+v", parsed)
	}
}

func TestParseProseAroundObject(t *testing.T) {
	text := `{"verdict":{"safeToMerge":true,"summary":"ok"},"findings":[]} thanks`
	parsed, err := Parse(json.RawMessage("null"), text)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if !parsed.Verdict.SafeToMerge {
		t.Fatalf("parsed = %+v", parsed)
	}
}

func TestParseRejectsInvalidOutput(t *testing.T) {
	if _, err := Parse(nil, "not json at all"); err == nil {
		t.Fatal("expected an error")
	}
	if _, err := Parse(json.RawMessage(`{broken`), ""); err == nil {
		t.Fatal("expected an error for broken structured output")
	}
}

func TestSanitizeResolvesLineFromEvidence(t *testing.T) {
	item := finding(SeverityWarning, "retry comment", checkoutEvidence)
	item.Line = 999
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, fixtureGrounding())

	if len(out.Findings) != 1 {
		t.Fatalf("findings = %+v, dropped = %+v", out.Findings, out.Dropped)
	}
	if out.Findings[0].Line != 3 {
		t.Fatalf("line = %d, want the changed line", out.Findings[0].Line)
	}
	if !out.Findings[0].Anchored {
		t.Fatal("a resolved finding must be anchored")
	}
}

func TestSanitizeResolvesDeletedLine(t *testing.T) {
	item := finding(SeverityWarning, "deleted function", "func checkout() {}")
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, Grounding{Files: diff.Parse([]byte(deletedPatch))})

	if len(out.Findings) != 1 {
		t.Fatalf("findings = %+v, dropped = %+v", out.Findings, out.Dropped)
	}
	if out.Findings[0].Line != 3 {
		t.Fatalf("line = %d, want the old-side line", out.Findings[0].Line)
	}
}

func TestSanitizeNormalizesEvidenceWhitespace(t *testing.T) {
	item := finding(SeverityWarning, "spacing", "  //   Retry reuses the request key.  ")
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, fixtureGrounding())
	if len(out.Findings) != 1 {
		t.Fatalf("findings = %+v, dropped = %+v", out.Findings, out.Dropped)
	}
}

func TestSanitizeCapsAndOrders(t *testing.T) {
	findings := make([]Finding, 0, 15)
	findings = append(findings, finding(SeverityBlocking, "last blocking", checkoutEvidence))
	for index := 0; index < 14; index++ {
		findings = append(findings, finding(SeverityWarning, fmt.Sprintf("warning %d", index), checkoutEvidence))
	}
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true, Summary: "ok"}, Findings: findings}, fixtureGrounding())

	if len(out.Findings) != maxFindings {
		t.Fatalf("findings = %d, want %d", len(out.Findings), maxFindings)
	}
	if out.Omitted != 3 {
		t.Fatalf("omitted = %d, want 3", out.Omitted)
	}
	if out.Findings[0].Severity != SeverityBlocking {
		t.Fatalf("blocking should sort first: %+v", out.Findings[0])
	}
	if out.Findings[0].ID != "F1" || out.Findings[len(out.Findings)-1].ID != "F12" {
		t.Fatalf("ids = %q..%q", out.Findings[0].ID, out.Findings[len(out.Findings)-1].ID)
	}
}

func TestSanitizeCapsPraise(t *testing.T) {
	findings := []Finding{
		finding(SeverityPraise, "one", checkoutEvidence),
		finding(SeverityPraise, "two", checkoutEvidence),
		finding(SeverityPraise, "three", checkoutEvidence),
	}
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true, Summary: "ok"}, Findings: findings}, fixtureGrounding())
	if len(out.Findings) != 2 || out.Omitted != 1 {
		t.Fatalf("findings = %d omitted = %d", len(out.Findings), out.Omitted)
	}
}

func TestSanitizeBlockingOverridesVerdict(t *testing.T) {
	out := Sanitize(Review{
		Verdict:  Verdict{SafeToMerge: true, Summary: "ok"},
		Findings: []Finding{finding(SeverityBlocking, "bug", checkoutEvidence)},
	}, fixtureGrounding())
	if out.Verdict.SafeToMerge {
		t.Fatal("blocking must force safeToMerge false")
	}
	if !out.Verdict.Overridden {
		t.Fatal("overridden must record the model's true verdict")
	}
}

func TestSanitizeEmptyUnsafeBecomesSafe(t *testing.T) {
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: false, Summary: "looks risky"}, Findings: []Finding{}}, fixtureGrounding())
	if !out.Verdict.SafeToMerge || !out.Verdict.Overridden {
		t.Fatalf("verdict = %+v", out.Verdict)
	}
}

func TestSanitizeDropsUnknownEnum(t *testing.T) {
	findings := []Finding{
		finding(Severity("critical"), "bad severity", checkoutEvidence),
		finding(SeverityWarning, "bad category", checkoutEvidence),
	}
	findings[1].Category = Category("style")
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: findings}, fixtureGrounding())
	if len(out.Findings) != 0 {
		t.Fatalf("findings = %+v", out.Findings)
	}
	if len(out.Dropped) != 2 || out.Dropped[0].Reason != reasonInvalidField {
		t.Fatalf("dropped = %+v", out.Dropped)
	}
}

func TestSanitizeDeduplicatesNormalizedTitles(t *testing.T) {
	findings := []Finding{
		finding(SeverityWarning, "Same claim", checkoutEvidence),
		finding(SeverityWarning, "same   claim", checkoutEvidence),
	}
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: findings}, fixtureGrounding())
	if len(out.Findings) != 1 || out.Omitted != 1 {
		t.Fatalf("findings = %d omitted = %d", len(out.Findings), out.Omitted)
	}
	if len(out.Dropped) != 1 || out.Dropped[0].Reason != reasonDuplicate {
		t.Fatalf("dropped = %+v", out.Dropped)
	}
}

func TestSanitizeClampsStrings(t *testing.T) {
	long := strings.Repeat("x", 500)
	item := finding(SeverityWarning, long, checkoutEvidence)
	item.Claim = long
	item.Suggestion = long
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true, Summary: long}, Findings: []Finding{item}}, fixtureGrounding())
	if len(out.Findings) != 1 {
		t.Fatalf("findings = %+v, dropped = %+v", out.Findings, out.Dropped)
	}
	got := out.Findings[0]
	if len([]rune(got.Title)) != maxTitleRunes || len([]rune(got.Claim)) != maxClaimRunes ||
		len([]rune(got.Suggestion)) != maxSuggestionRunes {
		t.Fatalf("clamp = %d/%d/%d", len([]rune(got.Title)), len([]rune(got.Claim)), len([]rune(got.Suggestion)))
	}
	if len([]rune(out.Verdict.Summary)) > maxSummaryRunes {
		t.Fatalf("summary = %d runes", len([]rune(out.Verdict.Summary)))
	}
}

func TestSanitizeHidesUngroundedFindings(t *testing.T) {
	findings := []Finding{
		finding(SeverityWarning, "inside hunk", checkoutEvidence),
		finding(SeverityWarning, "context line in hunk", "package api"),
		finding(SeverityWarning, "no evidence", ""),
		finding(SeverityBlocking, "not in diff", "func missing() {}"),
		finding(SeverityWarning, "missing file", checkoutEvidence),
	}
	findings[4].File = "api/gone.go"
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: findings}, fixtureGrounding())

	if len(out.Findings) != 1 {
		t.Fatalf("findings = %d, want the one grounded finding", len(out.Findings))
	}
	if out.Unverified != 4 {
		t.Fatalf("unverified = %d, want 4", out.Unverified)
	}
	if out.UnverifiedBlocking != 1 {
		t.Fatalf("unverified blocking = %d, want 1", out.UnverifiedBlocking)
	}
	if out.Verdict.SafeToMerge {
		t.Error("a hidden blocking finding must keep the verdict conservative")
	}
	reasons := make(map[string]bool, len(out.Dropped))
	for _, dropped := range out.Dropped {
		reasons[dropped.Reason] = true
	}
	for _, want := range []string{reasonNoEvidence, reasonEvidenceNotChanged, reasonFileNotChanged} {
		if !reasons[want] {
			t.Fatalf("missing dropped reason %q in %+v", want, out.Dropped)
		}
	}
}

func TestSanitizeEntityMustContainEvidence(t *testing.T) {
	files := fixtureFiles()
	files[0].Semantic = []diff.SemanticChange{
		{EntityName: "checkout", ChangeType: "modified", StartLine: 1, EndLine: 2},
	}
	item := finding(SeverityWarning, "outside entity", checkoutEvidence)
	item.Entity = "checkout"
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, Grounding{Files: files})

	if len(out.Findings) != 0 {
		t.Fatalf("findings = %+v", out.Findings)
	}
	if len(out.Dropped) != 1 || out.Dropped[0].Reason != reasonEntityMismatch {
		t.Fatalf("dropped = %+v", out.Dropped)
	}
}

func TestSanitizeEntityContainsEvidence(t *testing.T) {
	files := fixtureFiles()
	files[0].Semantic = []diff.SemanticChange{
		{EntityName: "checkout", ChangeType: "modified", StartLine: 3, EndLine: 4},
	}
	item := finding(SeverityWarning, "inside entity", checkoutEvidence)
	item.Entity = "helper / checkout"
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, Grounding{Files: files})

	if len(out.Findings) != 1 {
		t.Fatalf("findings = %+v, dropped = %+v", out.Findings, out.Dropped)
	}
	if out.Findings[0].Entity != "checkout" || out.Findings[0].Line != 3 {
		t.Fatalf("finding = %+v", out.Findings[0])
	}
}

func TestSanitizeUnknownEntityIsHidden(t *testing.T) {
	item := finding(SeverityWarning, "unknown entity", checkoutEvidence)
	item.Entity = "helper not in sem"
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, fixtureGrounding())

	if len(out.Findings) != 0 || out.Unverified != 1 {
		t.Fatalf("findings = %d unverified = %d", len(out.Findings), out.Unverified)
	}
}

func TestSanitizeRequiresGuidelineQuote(t *testing.T) {
	item := finding(SeverityWarning, "dependencies", checkoutEvidence)
	item.Category = CategoryConventions
	item.Guideline = "AGENTS.md"
	item.GuidelineQuote = "Do not add dependencies."
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, fixtureGrounding())
	if len(out.Findings) != 1 {
		t.Fatalf("findings = %+v, dropped = %+v", out.Findings, out.Dropped)
	}
}

func TestSanitizeHidesInventedGuideline(t *testing.T) {
	item := finding(SeverityWarning, "invented rule", checkoutEvidence)
	item.Category = CategoryConventions
	item.Guideline = "AGENTS.md"
	item.GuidelineQuote = "Never use maps."
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, fixtureGrounding())
	if len(out.Findings) != 0 {
		t.Fatalf("findings = %+v", out.Findings)
	}
	if len(out.Dropped) != 1 || out.Dropped[0].Reason != reasonGuidelineMismatch {
		t.Fatalf("dropped = %+v", out.Dropped)
	}
}

func TestSanitizeConventionsCannotBlock(t *testing.T) {
	item := finding(SeverityBlocking, "style blocker", checkoutEvidence)
	item.Category = CategoryConventions
	item.Guideline = "AGENTS.md"
	item.GuidelineQuote = "Use Bun."
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: []Finding{item}}, fixtureGrounding())
	if len(out.Findings) != 0 {
		t.Fatalf("findings = %+v", out.Findings)
	}
	if len(out.Dropped) != 1 || out.Dropped[0].Reason != reasonSeverityRule {
		t.Fatalf("dropped = %+v", out.Dropped)
	}
}

func TestSanitizeOrderIsStable(t *testing.T) {
	findings := []Finding{
		finding(SeverityWarning, "zeta", checkoutEvidence),
		finding(SeverityWarning, "alpha", checkoutEvidence),
		finding(SeverityWarning, "later", checkoutSecondEvidence),
	}
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: findings}, fixtureGrounding())
	if len(out.Findings) != 3 {
		t.Fatalf("findings = %+v", out.Findings)
	}
	got := []string{out.Findings[0].Title, out.Findings[1].Title, out.Findings[2].Title}
	want := []string{"alpha", "zeta", "later"}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

func TestSanitizeFallsBackToSummary(t *testing.T) {
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true, Summary: ""}, Findings: []Finding{}}, fixtureGrounding())
	if out.Verdict.Summary == "" {
		t.Fatal("an empty summary must get a fallback")
	}
}
