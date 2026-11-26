package github

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Raist90/triage/backend/internal/gql"
)

type listTestRequest struct {
	Query string `json:"query"`
}

// listTestServer answers one repo search per request. replies maps a repo name
// to its HTTP status (0 means 200) and PR number.
func listTestServer(
	t *testing.T,
	replies map[string]struct {
		status int
		number int
	},
) (*httptest.Server, func() map[string]int) {
	t.Helper()

	var mu sync.Mutex
	calls := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request listTestRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		name := ""
		for candidate := range replies {
			if strings.Contains(request.Query, "repo:"+candidate) {
				name = candidate
				break
			}
		}
		if name == "" {
			t.Errorf("query names no known repo: %s", request.Query)
			return
		}
		mu.Lock()
		calls[name]++
		mu.Unlock()

		reply := replies[name]
		if reply.status != 0 {
			w.WriteHeader(reply.status)
			return
		}
		// The slow repo answers last, so ordering cannot come from arrival.
		if strings.Contains(name, "slow") {
			time.Sleep(30 * time.Millisecond)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"viewer":{"login":"viewer"},"r0":{"nodes":[{"__typename":"PullRequest","number":` +
			strconv.Itoa(reply.number) + `,"author":{"login":"someone"},"repository":{"nameWithOwner":` +
			strconv.Quote(name) + `}}]}}}`))
	}))
	t.Cleanup(server.Close)

	return server, func() map[string]int {
		mu.Lock()
		defer mu.Unlock()
		snapshot := make(map[string]int, len(calls))
		for name, count := range calls {
			snapshot[name] = count
		}
		return snapshot
	}
}

func TestListPRsMergesReposInConfigOrder(t *testing.T) {
	server, _ := listTestServer(t, map[string]struct {
		status int
		number int
	}{
		"acme/slow": {number: 1},
		"acme/fast": {number: 2},
	})
	client := &Client{token: "test", gql: gql.NewClient(server.URL, "test")}

	result, err := client.ListPRs(context.Background(), TabAll, "", []string{"acme/slow", "acme/fast"})
	if err != nil {
		t.Fatalf("ListPRs: %v", err)
	}
	if result.Viewer.Login != "viewer" {
		t.Fatalf("viewer = %q, want viewer", result.Viewer.Login)
	}
	if len(result.PRs) != 2 {
		t.Fatalf("prs = %d, want 2", len(result.PRs))
	}
	if result.PRs[0].Number != 1 || result.PRs[1].Number != 2 {
		t.Fatalf("prs = [%d %d], want config order [1 2]", result.PRs[0].Number, result.PRs[1].Number)
	}
}

func TestListPRsRetriesAProvider5xxOnce(t *testing.T) {
	server, calls := listTestServer(t, map[string]struct {
		status int
		number int
	}{
		"acme/good": {number: 1},
		"acme/bad":  {status: http.StatusBadGateway},
	})
	client := &Client{token: "test", gql: gql.NewClient(server.URL, "test")}

	_, err := client.ListPRs(context.Background(), TabAll, "", []string{"acme/good", "acme/bad"})
	if err == nil {
		t.Fatal("ListPRs succeeded with a failing repo")
	}
	var apiErr *gql.APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusBadGateway {
		t.Fatalf("err = %v, want a 502 APIError", err)
	}
	if got := calls()["acme/bad"]; got != 2 {
		t.Fatalf("bad repo calls = %d, want 2 (one retry)", got)
	}
	if got := calls()["acme/good"]; got != 1 {
		t.Fatalf("good repo calls = %d, want 1", got)
	}
}
