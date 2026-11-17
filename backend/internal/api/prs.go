package api

import (
	"context"
	"net/http"

	"github.com/Raist90/triage/backend/internal/github"
)

type prListInput struct {
	Tab     string `query:"tab" doc:"mine, review, or all"`
	Repo    string `query:"repo" pattern:"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" doc:"Limit the list to one owner/name repo"`
	Refresh bool   `query:"refresh" doc:"Bypass the cached response"`
}

type prDetailInput struct {
	PRPath
	Refresh bool `query:"refresh" doc:"Bypass the cached response"`
}

type diffInput struct {
	PRPath
	Refresh bool `query:"refresh" doc:"Bypass the cached head and diff"`
}

// getPRs serves GET /prs?tab=mine&repo=owner/name&refresh=1.
func (s *Server) getPRs(ctx context.Context, in *prListInput) (*prListOutput, error) {
	if !github.ValidateTab(in.Tab) {
		return nil, errorf(http.StatusBadRequest, codeBadRequest, "tab must be one of mine, review, all")
	}

	repos := make([]string, 0, len(s.cfg.Repos))
	if in.Repo != "" {
		repos = append(repos, in.Repo)
	} else {
		for _, tracked := range s.cfg.Repos {
			repos = append(repos, tracked.Owner+"/"+tracked.Name)
		}
	}

	vars := listVars{Tab: in.Tab, Repo: in.Repo, Repos: repos}

	var result github.ListResult
	err := s.loadCached("prs", vars, s.cfg.Cache.GraphQL, in.Refresh, &result, func() error {
		fetched, err := s.github.ListPRs(ctx, in.Tab, in.Repo, repos)
		if err != nil {
			return err
		}
		result = fetched
		return nil
	})
	if err != nil {
		return nil, s.providerError(err)
	}
	return &prListOutput{Body: result}, nil
}

// getPR serves GET /pr/{owner}/{repo}/{number}.
func (s *Server) getPR(ctx context.Context, in *prDetailInput) (*prDetailOutput, error) {
	vars := prVars{Owner: in.Owner, Repo: in.Repo, Number: in.Number}

	var pr github.PR
	// v5 adds mergeability and whether squash merge is allowed.
	err := s.loadCached(prDetailRoute, vars, s.cfg.Cache.GraphQL, in.Refresh, &pr, func() error {
		fetched, err := s.github.GetPR(ctx, in.Owner, in.Repo, in.Number)
		if err != nil {
			return err
		}
		pr = fetched
		return nil
	})
	if err != nil {
		return nil, s.providerError(err)
	}
	return &prDetailOutput{Body: prDetailResponse{PR: pr}}, nil
}

// getPRDiff serves GET /pr/{owner}/{repo}/{number}/diff.
func (s *Server) getPRDiff(ctx context.Context, in *diffInput) (*diffOutput, error) {
	// The diff belongs to one commit, so the head must be resolved first. A
	// manual refresh re-reads it instead of trusting the detail cache.
	pr, err := s.prMetadata(ctx, in.Owner, in.Repo, in.Number, in.Refresh)
	if err != nil {
		return nil, s.providerError(err)
	}
	if pr.HeadSHA == "" {
		return nil, errorf(http.StatusBadGateway, codeGitHub, "GitHub did not report the head commit")
	}
	body, err := s.loadDiff(ctx, in.Owner, in.Repo, in.Number, pr.HeadSHA, in.Refresh)
	if err != nil {
		return nil, s.providerError(err)
	}
	return &diffOutput{Body: buildDiffResponse(ctx, body, pr.HeadSHA)}, nil
}
