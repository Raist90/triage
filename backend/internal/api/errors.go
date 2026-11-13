package api

import "net/http"

// errorEnvelope is the only error shape the server returns.
type errorEnvelope struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error codes.
const (
	codeUnauthorized     = "unauthorized"
	codeNotFound         = "not_found"
	codeMethodNotAllowed = "method_not_allowed"
	codeCache            = "cache_error"
	codeGitHub           = "github_error"
	codeBadRequest       = "bad_request"
	codeInternal         = "internal_error"
)

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorEnvelope{Error: errorBody{Code: code, Message: message}})
}
