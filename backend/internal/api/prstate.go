package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/Raist90/triage/backend/internal/gql"
)

// maxPRStateBody caps the two small action payloads.
const maxPRStateBody = 8 << 10

// setPRDraft serves POST /pr/{owner}/{repo}/{number}/draft.
func (s *Server) setPRDraft(ctx context.Context, in *draftInput) (*okOutput, error) {
	if in.Body.Draft == nil {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, `body must be {"draft": true|false}`)
	}

	err := s.github.SetDraft(ctx, in.Owner, in.Repo, in.Number, *in.Body.Draft)
	// Drop the cached detail even on failure: a rejected toggle still means the
	// cached draft state may be stale.
	s.invalidatePR(in.Owner, in.Repo, in.Number)
	if err != nil {
		return nil, s.prStateError(err)
	}

	return &okOutput{Body: okResponse{OK: true}}, nil
}

// closePR serves POST /pr/{owner}/{repo}/{number}/close. Closing needs no body:
// the request itself is the whole intent, and the UI confirms first.
func (s *Server) closePR(ctx context.Context, in *prTargetInput) (*okOutput, error) {
	err := s.github.ClosePR(ctx, in.Owner, in.Repo, in.Number)
	// Drop the cached detail even on failure so a rejected close cannot leave a
	// stale open state behind.
	s.invalidatePR(in.Owner, in.Repo, in.Number)
	if err != nil {
		return nil, s.prStateError(err)
	}

	return &okOutput{Body: okResponse{OK: true}}, nil
}

// mergePR serves POST /pr/{owner}/{repo}/{number}/merge.
func (s *Server) mergePR(ctx context.Context, in *mergeInput) (*okOutput, error) {
	if strings.ToLower(strings.TrimSpace(in.Body.Method)) != "squash" {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "method must be squash")
	}

	err := s.github.MergeSquash(ctx, in.Owner, in.Repo, in.Number, strings.TrimSpace(in.Body.SHA))
	// A rejected merge often means the head moved, so refresh the cached detail
	// even when GitHub refuses the action.
	s.invalidatePR(in.Owner, in.Repo, in.Number)
	if err != nil {
		return nil, s.prStateError(err)
	}

	return &okOutput{Body: okResponse{OK: true}}, nil
}

// prStateError turns GitHub's merge and draft validation failures into a
// conflict, keeping the provider message so the user sees why the action failed.
func (s *Server) prStateError(err error) error {
	var apiErr *gql.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case http.StatusMethodNotAllowed, http.StatusConflict, http.StatusUnprocessableEntity:
			return errorf(http.StatusConflict, codeConflict, apiErr.Message)
		}
	}
	return s.providerError(err)
}
