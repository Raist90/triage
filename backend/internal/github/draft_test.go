package github

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Raist90/triage/backend/internal/gql"
)

type draftTestRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables"`
}

// draftTestServer records every GraphQL request and replies in order.
func draftTestServer(t *testing.T, replies []string) (*httptest.Server, *[]draftTestRequest) {
	t.Helper()

	var calls []draftTestRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request draftTestRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		calls = append(calls, request)

		w.Header().Set("Content-Type", "application/json")
		if len(calls) > len(replies) {
			t.Errorf("unexpected request %d", len(calls))
			return
		}
		_, _ = io.WriteString(w, replies[len(calls)-1])
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

func TestSetDraftUsesGraphQLMutations(t *testing.T) {
	cases := []struct {
		name     string
		draft    bool
		mutation string
	}{
		{name: "mark ready for review", draft: false, mutation: "markPullRequestReadyForReview"},
		{name: "convert to draft", draft: true, mutation: "convertPullRequestToDraft"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, calls := draftTestServer(t, []string{
				`{"data":{"repository":{"pullRequest":{"id":"PR_1"}}}}`,
				`{"data":{"pullRequest":{"isDraft":false}}}`,
			})
			client := &Client{token: "test", gql: gql.NewClient(server.URL, "test")}

			if err := client.SetDraft(context.Background(), "o", "r", 7, tc.draft); err != nil {
				t.Fatalf("SetDraft: %v", err)
			}
			if len(*calls) != 2 {
				t.Fatalf("requests = %d, want 2", len(*calls))
			}
			if !strings.Contains((*calls)[0].Query, "PRNodeID") {
				t.Fatalf("first query = %q, want the node ID lookup", (*calls)[0].Query)
			}
			if !strings.Contains((*calls)[1].Query, tc.mutation) {
				t.Fatalf("mutation = %q, want %q", (*calls)[1].Query, tc.mutation)
			}
			if got := (*calls)[1].Variables["id"]; got != "PR_1" {
				t.Fatalf("mutation id = %v, want PR_1", got)
			}
		})
	}
}

func TestSetDraftSurfacesGraphQLError(t *testing.T) {
	cases := []struct {
		name   string
		errors string
		status int
		want   string
	}{
		{
			name:   "not found",
			errors: `[{"type":"NOT_FOUND","message":"Could not resolve to a node"}]`,
			status: http.StatusNotFound,
			want:   "Could not resolve to a node",
		},
		{
			name:   "not a draft",
			errors: `[{"type":"UNPROCESSABLE","message":"Pull request is not a draft"}]`,
			status: http.StatusUnprocessableEntity,
			want:   "Pull request is not a draft",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, _ := draftTestServer(t, []string{
				`{"data":{"repository":{"pullRequest":{"id":"PR_1"}}}}`,
				`{"errors":` + tc.errors + `}`,
			})
			client := &Client{token: "test", gql: gql.NewClient(server.URL, "test")}

			err := client.SetDraft(context.Background(), "o", "r", 7, false)
			var apiErr *gql.APIError
			if !errors.As(err, &apiErr) {
				t.Fatalf("error = %v, want APIError", err)
			}
			if apiErr.Status != tc.status {
				t.Fatalf("status = %d, want %d", apiErr.Status, tc.status)
			}
			if apiErr.Message != tc.want {
				t.Fatalf("message = %q, want %q", apiErr.Message, tc.want)
			}
		})
	}
}

func TestSetDraftMissingPullRequestIsNotFound(t *testing.T) {
	server, _ := draftTestServer(t, []string{
		`{"data":{"repository":{"pullRequest":null}}}`,
	})
	client := &Client{token: "test", gql: gql.NewClient(server.URL, "test")}

	err := client.SetDraft(context.Background(), "o", "r", 7, false)
	var apiErr *gql.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %v, want APIError", err)
	}
	if apiErr.Status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", apiErr.Status)
	}
}
