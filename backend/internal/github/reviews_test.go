package github

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &Client{token: "test", web: &webClient{token: "test", http: server.Client(), baseURL: server.URL}}
}

func TestCreatePendingReviewSendsNoEvent(t *testing.T) {
	var path, method string
	var payload map[string]any

	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		path, method = r.URL.Path, r.Method
		_ = json.NewDecoder(r.Body).Decode(&payload)
		_, _ = w.Write([]byte(`{"id":77}`))
	})

	id, err := client.CreatePendingReview(context.Background(), "o", "r", 7, "abc123", []DraftComment{
		{Body: "**boom**", Path: "src/main.go", Line: 4, Side: CommentSideRight},
	})
	if err != nil {
		t.Fatalf("CreatePendingReview: %v", err)
	}
	if id != 77 {
		t.Fatalf("id = %d, want 77", id)
	}
	if method != http.MethodPost || path != "/repos/o/r/pulls/7/reviews" {
		t.Fatalf("request = %s %s", method, path)
	}
	if _, ok := payload["event"]; ok {
		t.Fatalf("a draft review must not carry an event: %v", payload)
	}
	if payload["commit_id"] != "abc123" {
		t.Fatalf("commit_id = %v", payload["commit_id"])
	}
	comments, ok := payload["comments"].([]any)
	if !ok || len(comments) != 1 {
		t.Fatalf("comments = %v", payload["comments"])
	}
	comment := comments[0].(map[string]any)
	if comment["path"] != "src/main.go" || comment["line"] != float64(4) || comment["side"] != CommentSideRight {
		t.Fatalf("comment = %v", comment)
	}
}

func TestListPendingReviewsKeepsOnlyDrafts(t *testing.T) {
	var path string
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_, _ = w.Write([]byte(`[
			{"id": 1, "state": "PENDING"},
			{"id": 2, "state": "COMMENTED"},
			{"id": 3, "state": "PENDING"}
		]`))
	})

	ids, err := client.ListPendingReviews(context.Background(), "o", "r", 7)
	if err != nil {
		t.Fatalf("ListPendingReviews: %v", err)
	}
	if path != "/repos/o/r/pulls/7/reviews" {
		t.Fatalf("path = %s", path)
	}
	if len(ids) != 2 || ids[0] != 1 || ids[1] != 3 {
		t.Fatalf("ids = %v, want [1 3]", ids)
	}
}

func TestSubmitAndDeletePendingReviewUseTheReviewID(t *testing.T) {
	var paths []string
	var event map[string]any
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		if r.Method == http.MethodPost {
			_ = json.NewDecoder(r.Body).Decode(&event)
		}
		_, _ = w.Write([]byte(`{}`))
	})

	ctx := context.Background()
	if err := client.SubmitPendingReview(ctx, "o", "r", 7, 42, ReviewComment, "summary"); err != nil {
		t.Fatalf("SubmitPendingReview: %v", err)
	}
	if err := client.DeletePendingReview(ctx, "o", "r", 7, 42); err != nil {
		t.Fatalf("DeletePendingReview: %v", err)
	}

	if len(paths) != 2 ||
		paths[0] != "POST /repos/o/r/pulls/7/reviews/42/events" ||
		paths[1] != "DELETE /repos/o/r/pulls/7/reviews/42" {
		t.Fatalf("requests = %v", paths)
	}
	if event["event"] != ReviewComment || event["body"] != "summary" {
		t.Fatalf("event payload = %v", event)
	}
}
