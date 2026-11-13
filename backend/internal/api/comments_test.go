package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleCommentsRejectsInvalidPayloads(t *testing.T) {
	valid := `{"body":"ok","path":"main.go","line":3,"side":"RIGHT","commitId":"abc"}`

	cases := []struct {
		name   string
		method string
		body   string
	}{
		{name: "empty body", method: http.MethodPost, body: `{"body":" ","path":"main.go","line":3,"side":"RIGHT","commitId":"abc"}`},
		{name: "missing path", method: http.MethodPost, body: `{"body":"ok","path":"","line":3,"side":"RIGHT","commitId":"abc"}`},
		{name: "bad line", method: http.MethodPost, body: `{"body":"ok","path":"main.go","line":0,"side":"RIGHT","commitId":"abc"}`},
		{name: "bad side", method: http.MethodPost, body: `{"body":"ok","path":"main.go","line":3,"side":"MIDDLE","commitId":"abc"}`},
		{name: "missing commit", method: http.MethodPost, body: `{"body":"ok","path":"main.go","line":3,"side":"RIGHT","commitId":""}`},
		{name: "unknown field", method: http.MethodPost, body: `{"body":"ok","path":"main.go","line":3,"side":"RIGHT","commitId":"abc","extra":1}`},
		{name: "wrong method", method: http.MethodDelete, body: valid},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "/pr/o/r/1/comments", strings.NewReader(tc.body))
			recorder := httptest.NewRecorder()
			(&Server{}).handleComments(recorder, request, "o", "r", "1")

			if recorder.Code != http.StatusBadRequest && recorder.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestHandleCommentDeleteRejectsInvalidInput(t *testing.T) {
	cases := []struct {
		name   string
		method string
		rawID  string
		status int
	}{
		{name: "wrong method", method: http.MethodGet, rawID: "12", status: http.StatusMethodNotAllowed},
		{name: "bad id", method: http.MethodDelete, rawID: "nope", status: http.StatusBadRequest},
		{name: "zero id", method: http.MethodDelete, rawID: "0", status: http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, "/pr/o/r/1/comments/"+tc.rawID, nil)
			recorder := httptest.NewRecorder()
			(&Server{}).handleCommentDelete(recorder, request, "o", "r", "1", tc.rawID)
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.status)
			}
		})
	}
}

func TestHandleCommentsRejectsBadRepoOrNumber(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/pr/bad/1/comments", nil)
	recorder := httptest.NewRecorder()
	(&Server{}).handleComments(recorder, request, "bad", "", "1")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("repo status = %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "/pr/o/r/nope/comments", nil)
	recorder = httptest.NewRecorder()
	(&Server{}).handleComments(recorder, request, "o", "r", "nope")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("number status = %d", recorder.Code)
	}
}
