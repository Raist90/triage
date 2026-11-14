package github

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Raist90/triage/backend/internal/gql"
)

// closeTestServer records the PATCH it receives and replies with status/body.
func closeTestServer(t *testing.T, status int, body string) (*httptest.Server, *http.Request, *string) {
	t.Helper()

	var seen http.Request
	var payload string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = *r
		var decoded map[string]string
		if err := json.NewDecoder(r.Body).Decode(&decoded); err != nil {
			t.Errorf("decode body: %v", err)
		} else {
			encoded, _ := json.Marshal(decoded)
			payload = string(encoded)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server, &seen, &payload
}

func TestClosePRSendsClosedState(t *testing.T) {
	server, seen, payload := closeTestServer(t, http.StatusOK, `{"state":"closed"}`)
	client := &Client{
		token: "test",
		web:   &webClient{token: "test", http: server.Client(), baseURL: server.URL},
	}

	if err := client.ClosePR(context.Background(), "o", "r", 7); err != nil {
		t.Fatalf("ClosePR: %v", err)
	}
	if seen.Method != http.MethodPatch {
		t.Fatalf("method = %s, want PATCH", seen.Method)
	}
	if seen.URL.Path != "/repos/o/r/pulls/7" {
		t.Fatalf("path = %s, want /repos/o/r/pulls/7", seen.URL.Path)
	}
	if *payload != `{"state":"closed"}` {
		t.Fatalf("body = %s, want closed state", *payload)
	}
}

func TestClosePRRejectsUnclosedResponse(t *testing.T) {
	server, _, _ := closeTestServer(t, http.StatusOK, `{"state":"open"}`)
	client := &Client{
		token: "test",
		web:   &webClient{token: "test", http: server.Client(), baseURL: server.URL},
	}

	err := client.ClosePR(context.Background(), "o", "r", 7)
	var apiErr *gql.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %v, want APIError", err)
	}
	if apiErr.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", apiErr.Status)
	}
}

func TestClosePRKeepsProviderReason(t *testing.T) {
	server, _, _ := closeTestServer(t, http.StatusUnprocessableEntity,
		`{"message":"Pull request is already closed"}`)
	client := &Client{
		token: "test",
		web:   &webClient{token: "test", http: server.Client(), baseURL: server.URL},
	}

	err := client.ClosePR(context.Background(), "o", "r", 7)
	var apiErr *gql.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %v, want APIError", err)
	}
	if apiErr.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", apiErr.Status)
	}
	if apiErr.Message != "Pull request is already closed" {
		t.Fatalf("message = %q, want provider reason", apiErr.Message)
	}
}
