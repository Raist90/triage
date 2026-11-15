package api

import (
	"net/http"
	"testing"
)

func TestCommentsRejectInvalidPayloads(t *testing.T) {
	handler := testHandler(t)
	valid := `{"body":"ok","path":"main.go","line":3,"side":"RIGHT","commitId":"abc"}`

	cases := []struct {
		name   string
		method string
		body   string
		status int
	}{
		{name: "empty body", method: http.MethodPost, body: `{"body":" ","path":"main.go","line":3,"side":"RIGHT","commitId":"abc"}`, status: http.StatusBadRequest},
		{name: "missing path", method: http.MethodPost, body: `{"body":"ok","path":"","line":3,"side":"RIGHT","commitId":"abc"}`, status: http.StatusBadRequest},
		{name: "bad line", method: http.MethodPost, body: `{"body":"ok","path":"main.go","line":0,"side":"RIGHT","commitId":"abc"}`, status: http.StatusBadRequest},
		{name: "bad side", method: http.MethodPost, body: `{"body":"ok","path":"main.go","line":3,"side":"MIDDLE","commitId":"abc"}`, status: http.StatusUnprocessableEntity},
		{name: "missing commit", method: http.MethodPost, body: `{"body":"ok","path":"main.go","line":3,"side":"RIGHT","commitId":""}`, status: http.StatusBadRequest},
		{name: "wrong method", method: http.MethodDelete, body: valid, status: http.StatusMethodNotAllowed},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := serve(handler, tc.method, "/pr/o/r/1/comments", tc.body)
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, tc.status, recorder.Body.String())
			}
		})
	}
}

func TestCommentDeleteRejectsInvalidInput(t *testing.T) {
	handler := testHandler(t)

	cases := []struct {
		name   string
		method string
		rawID  string
		status int
	}{
		{name: "wrong method", method: http.MethodGet, rawID: "12", status: http.StatusMethodNotAllowed},
		{name: "bad id", method: http.MethodDelete, rawID: "nope", status: http.StatusUnprocessableEntity},
		{name: "zero id", method: http.MethodDelete, rawID: "0", status: http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := serve(handler, tc.method, "/pr/o/r/1/comments/"+tc.rawID, "")
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, tc.status, recorder.Body.String())
			}
		})
	}
}

func TestCommentsRejectBadRepoOrNumber(t *testing.T) {
	handler := testHandler(t)

	cases := []struct {
		name   string
		path   string
		status int
	}{
		{name: "bad number", path: "/pr/o/r/nope/comments", status: http.StatusUnprocessableEntity},
		{name: "zero number", path: "/pr/o/r/0/comments", status: http.StatusUnprocessableEntity},
		{name: "bad owner", path: "/pr/o%20x/r/1/comments", status: http.StatusUnprocessableEntity},
		{name: "short path", path: "/pr/o/r/comments", status: http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := serve(handler, http.MethodGet, tc.path, "")
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, tc.status, recorder.Body.String())
			}
		})
	}
}
