package worktree

import "errors"

// Error codes shared with the action envelope.
const (
	CodeRepoPathMissing = "repo_path_missing"
	CodeRepoPathInvalid = "repo_path_invalid"
	CodeWorktreeFailed  = "worktree_failed"
)

// Error is a classified worktree failure. Message is safe for the webview.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

// commandError carries the one-line stderr detail of a failed git command.
type commandError struct {
	err    error
	detail string
}

func (e *commandError) Error() string { return e.detail }
func (e *commandError) Unwrap() error { return e.err }

// failed wraps a git failure into a safe typed Error.
func failed(code, what string, err error) *Error {
	detail := "git command failed"
	var cmdErr *commandError
	if errors.As(err, &cmdErr) && cmdErr.detail != "" {
		detail = cmdErr.detail
	}
	return &Error{Code: code, Message: what + ": " + detail}
}
