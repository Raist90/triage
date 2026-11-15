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
}
