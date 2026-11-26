package api

import (
	"context"
	"net/http"
	"strings"

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
	err := s.loadCached(prListRoute, vars, s.cfg.Cache.GraphQL, in.Refresh, &result, func() error {
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
	// Review summaries live on disk, not in GitHub. Attach them after the cached
	// read every time so a finished review is visible on the next list read.
	s.attachReviewSummaries(&result)
	return &prListOutput{Body: result}, nil
}

// attachReviewSummaries adds the newest automatic review for each PR. It never
// consults or mutates the provider cache.
func (s *Server) attachReviewSummaries(result *github.ListResult) {
	if s.artifacts == nil {
		return
	}
	actionID := ""
	for _, action := range s.cfg.Actions.Items {
		if action.Kind == "review" {
			actionID = action.ID
			break
		}
	}
	if actionID == "" {
		return
	}
	for index := range result.PRs {
		pr := &result.PRs[index]
		owner, repo, ok := strings.Cut(pr.Repo, "/")
		if !ok || owner == "" || repo == "" {
			continue
		}
		artifact, found := s.artifacts.Latest(owner, repo, pr.Number, actionID)
		if !found || artifact.Review == nil {
			continue
		}
		summary := &github.ReviewSummary{
			CreatedAt: artifact.CreatedAt,
			SHA:       artifact.SHA,
			Stale:     pr.HeadSHA == "" || artifact.SHA != pr.HeadSHA,
		}
		for _, finding := range artifact.Review.Findings {
			switch string(finding.Severity) {
			case "blocking":
				summary.Blocking++
			case "warning":
				summary.Warning++
			case "nitpick":
				summary.Nitpick++
			case "praise":
				summary.Praise++
			}
		}
		pr.ReviewSummary = summary
	}
}

// getPR serves GET /pr/{owner}/{repo}/{number}.
func (s *Server) getPR(ctx context.Context, in *prDetailInput) (*prDetailOutput, error) {
	vars := prVars{Owner: in.Owner, Repo: in.Repo, Number: in.Number}

	var pr github.PR
	// v6 adds the merge receipt (mergedAt, mergedBy, mergeCommit).
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
