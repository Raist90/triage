package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/gql"
)

// maxReviewBody caps one review comment; GitHub's limit is 65536 characters.
const maxReviewBody = 64 << 10

// submitReview serves POST /pr/{owner}/{repo}/{number}/review.
func (s *Server) submitReview(ctx context.Context, in *reviewInput) (*okOutput, error) {
	event := strings.ToUpper(strings.TrimSpace(in.Body.Event))
	if !github.ValidateReviewEvent(event) {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "event must be APPROVE, REQUEST_CHANGES or COMMENT")
	}
	body := strings.TrimSpace(in.Body.Body)
	if len(body) > maxReviewBody {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "review comment is too long")
	}
	if body == "" && event != github.ReviewApprove {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "a comment is required to request changes or comment")
	}

	if err := s.github.SubmitReview(ctx, in.Owner, in.Repo, in.Number, event, body); err != nil {
		return nil, s.reviewError(err)
	}

	s.invalidatePR(in.Owner, in.Repo, in.Number)
	return &okOutput{Body: okResponse{OK: true}}, nil
}

// reviewError maps GitHub's validation failures (e.g. approving your own PR) to
// 400 instead of a misleading 502.
func (s *Server) reviewError(err error) error {
	var apiErr *gql.APIError
	if errors.As(err, &apiErr) && apiErr.Status == http.StatusUnprocessableEntity {
		return errorf(http.StatusBadRequest, codeBadRequest, apiErr.Message)
	}
	return s.providerError(err)
}

// invalidatePR drops the cached detail and every list tab that could show this
// PR. The diff and artifacts are keyed by commit, so they stay.
func (s *Server) invalidatePR(owner, repo string, number int) {
	if key, err := cache.Key("github", prDetailRoute, prVars{Owner: owner, Repo: repo, Number: number}); err == nil {
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
