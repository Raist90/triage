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
	codeConflict         = "conflict"
	codeInternal         = "internal_error"
	// Review patch apply failures. The webview maps these to readable copy.
	codeReviewStale     = "review_stale"
	codeWorktreeMissing = "worktree_missing"
	codePatchConflict   = "patch_conflict"
)

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorEnvelope{Error: errorBody{Code: code, Message: message}})
}
