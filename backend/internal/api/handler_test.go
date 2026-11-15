package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Raist90/triage/backend/internal/config"
)

// testToken is the bearer token every test server expects.
const testToken = "test-token"

// testHandler builds a Server with no provider dependencies. Only validation
// paths that never reach GitHub, the cache or the artifact store can be driven
// through it.
func testHandler(t *testing.T) http.Handler {
	t.Helper()
	return NewServer(config.Default(), nil, nil, nil, nil, nil, testToken, nil).Handler()
}

// serve sends the bearer token so the request reaches the operation.
func serve(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	return serveRequest(h, method, path, body, "Bearer "+testToken)
}

// serveAnonymous sends no credentials.
func serveAnonymous(h http.Handler, method, path string) *httptest.ResponseRecorder {
	return serveRequest(h, method, path, "", "")
}

func serveRequest(h http.Handler, method, path, body, authorization string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	h.ServeHTTP(recorder, request)
	return recorder
}
