package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/gql"
)

// maxReviewBody caps one review comment; GitHub's limit is 65536 characters.
const maxReviewBody = 64 << 10

// handleReview serves POST /pr/{owner}/{repo}/{number}/review.
func (s *Server) handleReview(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only POST is allowed")
		return
	}
	if !repoPattern.MatchString(owner + "/" + repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return
	}
	number, err := parseNumber(rawNumber)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "number must be a positive integer")
		return
	}

	var request reviewRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, maxReviewBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "invalid review body")
		return
	}

	event := strings.ToUpper(strings.TrimSpace(request.Event))
	if !github.ValidateReviewEvent(event) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "event must be APPROVE, REQUEST_CHANGES or COMMENT")
		return
	}
	body := strings.TrimSpace(request.Body)
	if len(body) > maxReviewBody {
		writeError(w, http.StatusBadRequest, codeBadRequest, "review comment is too long")
		return
	}
	if body == "" && event != github.ReviewApprove {
		writeError(w, http.StatusBadRequest, codeBadRequest, "a comment is required to request changes or comment")
		return
	}

	if err := s.github.SubmitReview(r.Context(), owner, repo, number, event, body); err != nil {
		s.writeReviewError(w, err)
		return
	}

	s.invalidatePR(owner, repo, number)
	writeJSON(w, http.StatusOK, reviewResponse{OK: true})
}

// writeReviewError maps GitHub's validation failures (e.g. approving your own
// PR) to 400 instead of a misleading 502.
func (s *Server) writeReviewError(w http.ResponseWriter, err error) {
	var apiErr *gql.APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusUnprocessableEntity {
		writeError(w, http.StatusBadRequest, codeBadRequest, apiErr.Message)
		return
	}
	s.writeProviderError(w, err)
}

// invalidatePR drops the cached detail and every list tab that could show this
// PR. The diff and artifacts are keyed by commit, so they stay.
func (s *Server) invalidatePR(owner, repo string, number int) {
	if key, err := cache.Key("github", "pr-detail-v4", prVars{Owner: owner, Repo: repo, Number: number}); err == nil {
		s.invalidateKey(key)
	}

	allRepos := make([]string, 0, len(s.cfg.Repos))
	for _, tracked := range s.cfg.Repos {
		allRepos = append(allRepos, tracked.Owner+"/"+tracked.Name)
	}

	requested := owner + "/" + repo
	targets := make([]string, 0, len(allRepos)+1)
	targets = append(targets, allRepos...)
	targets = append(targets, requested)
	for _, tab := range []string{github.TabMine, github.TabReview, github.TabAll} {
		s.invalidateListKey(listVars{Tab: tab, Repo: "", Repos: allRepos})
		for _, target := range targets {
			s.invalidateListKey(listVars{Tab: tab, Repo: target, Repos: []string{target}})
		}
	}
}

func (s *Server) invalidateListKey(vars listVars) {
	key, err := cache.Key("github", "prs", vars)
	if err != nil {
		return
	}
	s.invalidateKey(key)
}

func (s *Server) invalidateKey(key string) {
	if err := s.cache.Invalidate(key); err != nil {
		s.logger.Warn("cache invalidate failed", "err", err)
	}
}
