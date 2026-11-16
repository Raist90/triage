package actions

import (
	"errors"
	"fmt"
)

const (
	// Error codes shared with the HTTP envelope and the webview.
	CodeClaudeUnavailable = "claude_unavailable"
	CodeRepoNotConfigured = "repo_not_configured"
	CodeDiffUnavailable   = "diff_unavailable"
	CodeActionFailed      = "action_failed"
	CodeActionTimeout     = "action_timeout"
	CodeActionCanceled    = "action_canceled"
	CodeReviewInvalid     = "review_invalid"
)

// Action kinds. The registry sets these; an empty kind means explain, the
// original diff-only action.
const (
	KindExplain = "explain"
	KindReview  = "review"
)

// Job statuses.
const (
	StatusQueued     = "queued"
	StatusPreparing  = "preparing"
	StatusRunning    = "running"
	StatusValidating = "validating"
	StatusDone       = "done"
	StatusFailed     = "failed"
	StatusCanceled   = "canceled"
)

// Error is a classified runner failure. Message is safe for the webview.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func errorf(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// CodeOf extracts the safe code and message from a runner error.
func CodeOf(err error) (string, string) {
	var actionErr *Error
	if errors.As(err, &actionErr) {
		return actionErr.Code, actionErr.Message
	}
	return CodeActionFailed, "Claude action failed"
}

// ErrNoHead means the pull request metadata carried no head SHA.
var ErrNoHead = &Error{Code: CodeDiffUnavailable, Message: "Could not resolve the pull request head"}
