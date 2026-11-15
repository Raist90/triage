package api

import (
	"net/http"
	"strings"
	"testing"
)

func TestHealthIsUnauthenticated(t *testing.T) {
	recorder := serveAnonymous(testHandler(t), http.MethodGet, "/health")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"ok":true`) {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}

func TestProtectedRoutesRequireToken(t *testing.T) {
	recorder := serveAnonymous(testHandler(t), http.MethodGet, "/config")
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"code":"unauthorized"`) {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}

func TestUnknownRouteIsNotFound(t *testing.T) {
	recorder := serve(testHandler(t), http.MethodGet, "/nope", "")
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	// Unknown paths keep the shared envelope, not net/http's plain-text default.
	if !strings.Contains(recorder.Body.String(), `"code":"not_found"`) {
		t.Fatalf("body = %s", recorder.Body.String())
	}
}

// A known path with the wrong method must stay a 405. The 404 fallback must not
// swallow it while adding the envelope.
func TestKnownRouteKeepsMethodNotAllowed(t *testing.T) {
	handler := testHandler(t)
	cases := []struct{ method, path string }{
		{method: http.MethodGet, path: "/pr/o/r/1/close"},
		{method: http.MethodPut, path: "/prs"},
		// DELETE-only route, so only a per-method probe finds it.
		{method: http.MethodGet, path: "/pr/o/r/1/comments/12"},
	}
	for _, tc := range cases {
		recorder := serve(handler, tc.method, tc.path, "")
		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s: status = %d, want %d (body %s)", tc.method, tc.path, recorder.Code, http.StatusMethodNotAllowed, recorder.Body.String())
		}
	}
}

func TestStreamRouteRejectsBadRepo(t *testing.T) {
	// The stream is hand-written, so it must validate the path itself instead of
	// relying on Huma's tags.
	for _, path := range []string{
		"/pr/owner%20with%20space/r/1/actions/explain/stream",
		"/pr/o/r%2Fx/1/actions/explain/stream",
	} {
		recorder := serve(testHandler(t), http.MethodGet, path, "")
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want %d (body %s)", path, recorder.Code, http.StatusBadRequest, recorder.Body.String())
		}
		if !strings.Contains(recorder.Body.String(), `"code":"bad_request"`) {
			t.Fatalf("%s: body = %s", path, recorder.Body.String())
		}
	}
}
