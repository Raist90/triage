package api

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

// ErrorEnvelope is the only error shape the server returns. It is exported so
// the OpenAPI schema documents exactly what the webview parses.
type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code    string `json:"code" doc:"Stable machine-readable code the webview maps to copy"`
	Message string `json:"message" doc:"Human-readable message, safe to show"`
}

// Error codes.
const (
	codeUnauthorized     = "unauthorized"
	codeNotFound         = "not_found"
	codeMethodNotAllowed = "method_not_allowed"
	codeCache            = "cache_error"
	codeGitHub           = "github_error"
	codeBadRequest       = "bad_request"
	codeConflict         = "conflict"
	codeInternal         = "internal_error"
	// Review patch apply failures. The webview maps these to readable copy.
	codeReviewStale     = "review_stale"
	codeWorktreeMissing = "worktree_missing"
	codePatchConflict   = "patch_conflict"
)

// apiError is the error returned by every operation. Embedding ErrorEnvelope
// keeps the JSON identical to the middleware's writeError envelope, so the
// webview keeps one parser.
type apiError struct {
	ErrorEnvelope
	status int
}

func (e *apiError) Error() string {
	return e.ErrorEnvelope.Error.Message
}

func (e *apiError) GetStatus() int {
	return e.status
}

// ContentType keeps the envelope as application/json instead of Huma's default
// RFC 9457 problem+json.
func (e *apiError) ContentType(string) string {
	return "application/json"
}

// errorf builds an envelope error with an explicit code.
func errorf(status int, code, message string) *apiError {
	return &apiError{
		ErrorEnvelope: ErrorEnvelope{Error: ErrorBody{Code: code, Message: message}},
		status:        status,
	}
}

// newError is installed as huma.NewError so Huma's own validation failures
// (path, query, body parsing) use the same envelope and codes.
func newError(status int, message string, _ ...error) huma.StatusError {
	return errorf(status, codeForStatus(status), message)
}

func codeForStatus(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return codeUnauthorized
	case http.StatusNotFound:
		return codeNotFound
	case http.StatusMethodNotAllowed:
		return codeMethodNotAllowed
	case http.StatusConflict:
		return codeConflict
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return codeBadRequest
	case http.StatusBadGateway:
		return codeGitHub
	default:
		return codeInternal
	}
}
