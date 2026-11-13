package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/Raist90/triage/backend/internal/gql"
)

// maxPRStateBody caps the two small action payloads.
const maxPRStateBody = 8 << 10

// handlePRDraft serves POST /pr/{owner}/{repo}/{number}/draft.
func (s *Server) handlePRDraft(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only POST is allowed")
		return
	}
	number, ok := parsePRTarget(w, owner, repo, rawNumber)
	if !ok {
		return
	}

	var request draftRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxPRStateBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.Draft == nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "body must be {\"draft\": true|false}")
		return
	}

	err := s.github.SetDraft(r.Context(), owner, repo, number, *request.Draft)
	// Drop the cached detail even on failure: a rejected toggle still means the
	// cached draft state may be stale.
	s.invalidatePR(owner, repo, number)
	if err != nil {
		s.writePRStateError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, prStateResponse{OK: true})
}

// handlePRMerge serves POST /pr/{owner}/{repo}/{number}/merge.
func (s *Server) handlePRMerge(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only POST is allowed")
		return
	}
	number, ok := parsePRTarget(w, owner, repo, rawNumber)
	if !ok {
		return
	}

	var request mergeRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxPRStateBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid merge body")
		return
	}
	if strings.ToLower(strings.TrimSpace(request.Method)) != "squash" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "method must be squash")
		return
	}

	err := s.github.MergeSquash(r.Context(), owner, repo, number, strings.TrimSpace(request.SHA))
	// A rejected merge often means the head moved, so refresh the cached detail
	// even when GitHub refuses the action.
	s.invalidatePR(owner, repo, number)
	if err != nil {
		s.writePRStateError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, prStateResponse{OK: true})
}

// parsePRTarget validates the shared path parts, writing the error itself.
func parsePRTarget(w http.ResponseWriter, owner, repo, rawNumber string) (int, bool) {
	if !repoPattern.MatchString(owner + "/" + repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return 0, false
	}
	number, err := parseNumber(rawNumber)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "number must be a positive integer")
		return 0, false
	}
	return number, true
}

// writePRStateError turns GitHub's merge and draft validation failures into a
// conflict, keeping the provider message so the user sees why the action failed.
func (s *Server) writePRStateError(w http.ResponseWriter, err error) {
	var apiErr *gql.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case http.StatusMethodNotAllowed, http.StatusConflict, http.StatusUnprocessableEntity:
			writeError(w, http.StatusConflict, codeConflict, apiErr.Message)
			return
		}
	}
	s.writeProviderError(w, err)
}
