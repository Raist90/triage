package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlePRDraftRejectsInvalidPayloads(t *testing.T) {
	cases := []struct {
		name   string
		method string
		body   string
		status int
	}{
		{name: "wrong method", method: http.MethodGet, body: `{"draft":true}`, status: http.StatusMethodNotAllowed},
		{name: "empty body", method: http.MethodPost, body: ``, status: http.StatusBadRequest},
		{name: "missing draft", method: http.MethodPost, body: `{}`, status: http.StatusBadRequest},
		{name: "unknown field", method: http.MethodPost, body: `{"draft":true,"extra":1}`, status: http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "/pr/o/r/1/draft", strings.NewReader(tc.body))
			recorder := httptest.NewRecorder()
			(&Server{}).handlePRDraft(recorder, request, "o", "r", "1")
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.status)
			}
		})
	}
}

func TestHandlePRMergeRejectsInvalidPayloads(t *testing.T) {
	cases := []struct {
		name   string
		method string
		body   string
		status int
	}{
		{name: "wrong method", method: http.MethodGet, body: `{"method":"squash"}`, status: http.StatusMethodNotAllowed},
		{name: "empty body", method: http.MethodPost, body: ``, status: http.StatusBadRequest},
		{name: "unsupported method", method: http.MethodPost, body: `{"method":"merge"}`, status: http.StatusBadRequest},
		{name: "missing method", method: http.MethodPost, body: `{"sha":"abc"}`, status: http.StatusBadRequest},
		{name: "unknown field", method: http.MethodPost, body: `{"method":"squash","extra":1}`, status: http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "/pr/o/r/1/merge", strings.NewReader(tc.body))
			recorder := httptest.NewRecorder()
			(&Server{}).handlePRMerge(recorder, request, "o", "r", "1")
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.status)
			}
		})
	}
}

func TestHandlePRStateRejectsBadRepoOrNumber(t *testing.T) {
	cases := []struct {
		name   string
		owner  string
		repo   string
		number string
	}{
		{name: "bad repo", owner: "bad", repo: "", number: "1"},
		{name: "bad number", owner: "o", repo: "r", number: "nope"},
		{name: "zero number", owner: "o", repo: "r", number: "0"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			draftRequest := httptest.NewRequest(http.MethodPost, "/pr/o/r/1/draft", strings.NewReader(`{"draft":true}`))
			draftRecorder := httptest.NewRecorder()
			(&Server{}).handlePRDraft(draftRecorder, draftRequest, tc.owner, tc.repo, tc.number)
			if draftRecorder.Code != http.StatusBadRequest {
				t.Fatalf("draft status = %d, want 400", draftRecorder.Code)
			}

			mergeRequest := httptest.NewRequest(http.MethodPost, "/pr/o/r/1/merge", strings.NewReader(`{"method":"squash"}`))
			mergeRecorder := httptest.NewRecorder()
			(&Server{}).handlePRMerge(mergeRecorder, mergeRequest, tc.owner, tc.repo, tc.number)
			if mergeRecorder.Code != http.StatusBadRequest {
				t.Fatalf("merge status = %d, want 400", mergeRecorder.Code)
			}
		})
	}
}
