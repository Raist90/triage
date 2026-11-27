package api

import (
	"testing"

	"github.com/Raist90/triage/backend/internal/config"
)

func TestOpenAPIContract(t *testing.T) {
	doc := NewServer(config.Default(), nil, nil, nil, nil, nil, "", nil).OpenAPI()

	if doc.Info == nil || doc.Info.Title != apiTitle {
		t.Fatalf("info = %+v, want title %q", doc.Info, apiTitle)
	}

	// Every operation returns the app's envelope, so the error model must be
	// ours and not Huma's RFC 9457 default.
	schemas := doc.Components.Schemas.Map()
	errorSchema, ok := schemas["ApiError"]
	if !ok {
		t.Fatalf("missing ApiError schema, have %v", mapKeys(schemas))
	}
	if _, ok := errorSchema.Properties["error"]; !ok {
		t.Fatalf("ApiError is not the error envelope: %+v", errorSchema.Properties)
	}

	// Enum tags are what make the generated TypeScript a union instead of a
	// plain string. Losing one silently widens the frontend type.
	pr, ok := schemas["PR"]
	if !ok {
		t.Fatal("missing PR schema")
	}
	if got := len(pr.Properties["checkStatus"].Enum); got != 6 {
		t.Fatalf("PR.checkStatus enum has %d values, want 6", got)
	}

	for _, path := range []string{
		"/health",
		"/config",
		"/prs",
		"/pr/{owner}/{repo}/{number}",
		"/pr/{owner}/{repo}/{number}/diff",
		"/pr/{owner}/{repo}/{number}/review",
		"/pr/{owner}/{repo}/{number}/review/draft",
		"/pr/{owner}/{repo}/{number}/comments/{commentID}",
		"/pr/{owner}/{repo}/{number}/actions/{actionID}",
		"/pr/{owner}/{repo}/{number}/actions/{actionID}/patches/{findingID}",
		"/cache/invalidate",
	} {
		if doc.Paths[path] == nil {
			t.Errorf("missing path %s", path)
		}
	}

	// The SSE stream stays hand-written: Huma cannot describe long-lived frames.
	if doc.Paths["/pr/{owner}/{repo}/{number}/actions/{actionID}/stream"] != nil {
		t.Fatal("SSE stream must not be in the spec")
	}
}

func mapKeys[T any](m map[string]T) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}
