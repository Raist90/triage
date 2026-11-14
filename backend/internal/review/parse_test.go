package review

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/Raist90/triage/backend/internal/diff"
)

const checkoutPatch = `diff --git a/api/checkout.go b/api/checkout.go
index 1111111..2222222 100644
--- a/api/checkout.go
+++ b/api/checkout.go
@@ -1,3 +1,4 @@
 package api
 
+// Retry reuses the request key.
 func checkout() {}
`

func fixtureFiles() []diff.File {
	return diff.Parse([]byte(checkoutPatch))
}

func finding(severity Severity, title string, line int) Finding {
	return Finding{
		Severity: severity,
		Category: CategoryRisk,
		Title:    title,
		Claim:    "claim",
		File:     "api/checkout.go",
		Line:     line,
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

func TestSanitizeCapsAndOrders(t *testing.T) {
	findings := make([]Finding, 0, 15)
	findings = append(findings, finding(SeverityBlocking, "last blocking", 2))
	for index := 0; index < 14; index++ {
		findings = append(findings, finding(SeverityWarning, fmt.Sprintf("warning %d", index), 2))
	}
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true, Summary: "ok"}, Findings: findings}, fixtureFiles())

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
		finding(SeverityPraise, "one", 2),
		finding(SeverityPraise, "two", 2),
		finding(SeverityPraise, "three", 2),
	}
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true, Summary: "ok"}, Findings: findings}, fixtureFiles())
	if len(out.Findings) != 2 || out.Omitted != 1 {
		t.Fatalf("findings = %d omitted = %d", len(out.Findings), out.Omitted)
	}
}

func TestSanitizeBlockingOverridesVerdict(t *testing.T) {
	out := Sanitize(Review{
		Verdict:  Verdict{SafeToMerge: true, Summary: "ok"},
		Findings: []Finding{finding(SeverityBlocking, "bug", 2)},
	}, fixtureFiles())
	if out.Verdict.SafeToMerge {
		t.Fatal("blocking must force safeToMerge false")
	}
	if !out.Verdict.Overridden {
		t.Fatal("overridden must record the model's true verdict")
	}
}

func TestSanitizeEmptyUnsafeBecomesSafe(t *testing.T) {
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: false, Summary: "looks risky"}, Findings: []Finding{}}, fixtureFiles())
	if !out.Verdict.SafeToMerge || !out.Verdict.Overridden {
		t.Fatalf("verdict = %+v", out.Verdict)
	}
}

func TestSanitizeDropsUnknownEnum(t *testing.T) {
	findings := []Finding{
		finding(Severity("critical"), "bad severity", 2),
		finding(SeverityWarning, "bad category", 2),
	}
	findings[1].Category = Category("style")
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: findings}, fixtureFiles())
	if len(out.Findings) != 0 || out.Omitted != 2 {
		t.Fatalf("findings = %d omitted = %d", len(out.Findings), out.Omitted)
	}
}

func TestSanitizeDeduplicates(t *testing.T) {
	findings := []Finding{
		finding(SeverityWarning, "same", 2),
		finding(SeverityWarning, "same", 2),
	}
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: findings}, fixtureFiles())
	if len(out.Findings) != 1 || out.Omitted != 1 {
		t.Fatalf("findings = %d omitted = %d", len(out.Findings), out.Omitted)
	}
}

func TestSanitizeClampsStrings(t *testing.T) {
	long := strings.Repeat("x", 500)
	item := finding(SeverityWarning, long, 2)
	item.Claim = long
	item.Suggestion = long
	item.Entity = long
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true, Summary: long}, Findings: []Finding{item}}, fixtureFiles())
	got := out.Findings[0]
	if len([]rune(got.Title)) != maxTitleRunes || len([]rune(got.Claim)) != maxClaimRunes ||
		len([]rune(got.Suggestion)) != maxSuggestionRunes || len([]rune(got.Entity)) != maxEntityRunes {
		t.Fatalf("clamp = %d/%d/%d/%d", len([]rune(got.Title)), len([]rune(got.Claim)), len([]rune(got.Suggestion)), len([]rune(got.Entity)))
	}
	if len([]rune(out.Verdict.Summary)) > maxSummaryRunes {
		t.Fatalf("summary = %d runes", len([]rune(out.Verdict.Summary)))
	}
}

func TestSanitizeAnchors(t *testing.T) {
	findings := []Finding{
		finding(SeverityWarning, "inside hunk", 3),
		finding(SeverityWarning, "near hunk", 20),
		finding(SeverityWarning, "far hunk", 1000),
		finding(SeverityWarning, "missing file", 2),
	}
	findings[3].File = "api/gone.go"
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true}, Findings: findings}, fixtureFiles())

	if len(out.Findings) != 4 {
		t.Fatalf("findings = %d, want every finding kept", len(out.Findings))
	}
	if !out.Findings[0].Anchored {
		t.Error("line inside a hunk must be anchored")
	}
	if !out.Findings[1].Anchored {
		t.Error("line within 40 of a hunk must be anchored")
	}
	if out.Findings[2].Anchored {
		t.Error("line 1000 away must not be anchored")
	}
	if out.Findings[3].Anchored {
		t.Error("a file absent from the diff must not be anchored")
	}
}

func TestSanitizeFallsBackToSummary(t *testing.T) {
	out := Sanitize(Review{Verdict: Verdict{SafeToMerge: true, Summary: ""}, Findings: []Finding{}}, fixtureFiles())
	if out.Verdict.Summary == "" {
		t.Fatal("an empty summary must get a fallback")
	}
}
