package api

import (
	"net/http"
	"testing"
)

func TestPRDraftRejectsInvalidPayloads(t *testing.T) {
	handler := testHandler(t)

	cases := []struct {
		name   string
		method string
		body   string
		status int
	}{
		{name: "wrong method", method: http.MethodGet, body: `{"draft":true}`, status: http.StatusMethodNotAllowed},
		{name: "empty body", method: http.MethodPost, body: ``, status: http.StatusBadRequest},
		{name: "missing draft", method: http.MethodPost, body: `{}`, status: http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := serve(handler, tc.method, "/pr/o/r/1/draft", tc.body)
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, tc.status, recorder.Body.String())
			}
		})
	}
}

func TestPRMergeRejectsInvalidPayloads(t *testing.T) {
	handler := testHandler(t)

	cases := []struct {
		name   string
		method string
		body   string
		status int
	}{
		{name: "wrong method", method: http.MethodGet, body: `{"method":"squash"}`, status: http.StatusMethodNotAllowed},
		{name: "empty body", method: http.MethodPost, body: ``, status: http.StatusBadRequest},
		{name: "unsupported method", method: http.MethodPost, body: `{"method":"merge","sha":"abc"}`, status: http.StatusBadRequest},
		{name: "missing method", method: http.MethodPost, body: `{"sha":"abc"}`, status: http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := serve(handler, tc.method, "/pr/o/r/1/merge", tc.body)
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, tc.status, recorder.Body.String())
			}
		})
	}
}

func TestPRCloseRejectsInvalidRequests(t *testing.T) {
	handler := testHandler(t)

	cases := []struct {
		name   string
		method string
	}{
		{name: "wrong method", method: http.MethodGet},
		{name: "delete method", method: http.MethodDelete},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := serve(handler, tc.method, "/pr/o/r/1/close", "")
			if recorder.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, want %d (body %s)", recorder.Code, http.StatusMethodNotAllowed, recorder.Body.String())
			}
		})
	}
}

func TestPRStateRejectsBadRepoOrNumber(t *testing.T) {
	handler := testHandler(t)

	cases := []struct {
		name   string
		target string
		status int
	}{
		{name: "bad repo", target: "/pr/o%20x/r/1", status: http.StatusUnprocessableEntity},
		{name: "bad number", target: "/pr/o/r/nope", status: http.StatusUnprocessableEntity},
		{name: "zero number", target: "/pr/o/r/0", status: http.StatusUnprocessableEntity},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, route := range []struct {
				path string
				body string
			}{
				{path: "/draft", body: `{"draft":true}`},
				{path: "/merge", body: `{"method":"squash"}`},
				{path: "/close", body: ""},
			} {
				recorder := serve(handler, http.MethodPost, tc.target+route.path, route.body)
				if recorder.Code != tc.status {
					t.Fatalf("%s status = %d, want %d (body %s)", route.path, recorder.Code, tc.status, recorder.Body.String())
				}
			}
		})
	}
}
