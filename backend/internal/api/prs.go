package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/gql"
)

// prVars is the cache-key shape shared by every per-PR route. Field names are
// part of the key, so they must never change without bumping the route.
type prVars struct {
	Owner  string `json:"owner"`
	Repo   string `json:"repo"`
	Number int    `json:"number"`
}

// prDetailRoute is the stable cache route for one PR's detail. Bump it when the
// detail response shape changes so old cache entries are not decoded into it.
const prDetailRoute = "pr-detail-v5"

// listVars is the cache-key shape for one tab request.
type listVars struct {
	Tab   string   `json:"tab"`
	Repo  string   `json:"repo"`
	Repos []string `json:"repos"`
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
	body, err := s.loadDiff(ctx, in.Owner, in.Repo, in.Number, in.Refresh)
	if err != nil {
		return nil, s.providerError(err)
	}
	return &diffOutput{Body: buildDiffResponse(ctx, body)}, nil
}

// loadDiff returns the raw unified diff, cached by ETag. A refresh revalidates
// with the cached ETag, so an unchanged diff is a cheap 304.
func (s *Server) loadDiff(ctx context.Context, owner, repo string, number int, refresh bool) ([]byte, error) {
	vars := prVars{Owner: owner, Repo: repo, Number: number}

	key, err := cache.Key("github", "diff", vars)
	if err != nil {
		result, fetchErr := s.github.Diff(ctx, owner, repo, number, "")
		if fetchErr != nil {
			return nil, fetchErr
		}
		return result.Body, nil
	}

	entry, fresh := s.cache.Get(key, s.cfg.Cache.REST)
	if fresh && !refresh {
		if body, ok := decodeRawDiff(entry.Body); ok {
			return body, nil
		}
	}

	// A stale entry still supplies a validator, turning an expired diff into a
	// cheap 304 instead of a full download.
	etag := ""
	body := []byte(nil)
	if entry != nil {
		etag = entry.ETag
		body, _ = decodeRawDiff(entry.Body)
	}
	result, err := s.github.Diff(ctx, owner, repo, number, etag)
	if err != nil {
		return nil, err
	}
	if !result.NotModified {
		body = result.Body
	}
	if err := s.cache.Put(key, cache.Entry{Body: encodeRawDiff(body), ETag: result.ETag}); err != nil {
		s.logger.Warn("cache write failed", "err", err)
	}
	return body, nil
}

// buildDiffResponse parses the unified diff, annotates it with sem where
// available and ranks the files for review.
func buildDiffResponse(ctx context.Context, body []byte) diff.Response {
	files := diff.Parse(body)
	report, available := diff.Semantic(ctx, body)
	for index := range files {
		files[index].Kinds = diff.Kinds(files[index].Path)
		files[index].Semantic = report.Changes[files[index].Path]
		if !files[index].Binary {
			files[index].Hunks = diff.BuildHunksFor(files[index].Path, files[index].Patch)
			diff.Highlight(files[index].Path, files[index].Hunks)
		}
	}
	diff.Prioritize(files)
	response := diff.Response{
		Files:             files,
		SemanticAvailable: available,
		Complexity:        diff.ComplexityFor(files),
	}
	if available {
		summary := report.Summary
		response.SemanticSummary = &summary
	}
	return response
}

// loadCached returns a fresh cached JSON body or fetches and stores one.
// Cache failures are logged and never fail the request.
func (s *Server) loadCached(route string, vars any, ttl time.Duration, refresh bool, out any, fetch func() error) error {
	key, err := cache.Key("github", route, vars)
	if err != nil {
		s.logger.Warn("cache key failed", "err", err)
		return fetch()
	}

	if !refresh {
		if entry, ok := s.cache.Get(key, ttl); ok {
			if err := json.Unmarshal(entry.Body, out); err == nil {
				return nil
			}
		}
	}

	if err := fetch(); err != nil {
		return err
	}

	body, err := json.Marshal(out)
	if err != nil {
		s.logger.Warn("cache encode failed", "err", err)
		return nil
	}
	if err := s.cache.Put(key, cache.Entry{Body: body}); err != nil {
		s.logger.Warn("cache write failed", "err", err)
	}
	return nil
}

// providerError maps provider failures to safe API envelopes. Provider bodies
// and tokens never reach the webview.
func (s *Server) providerError(err error) error {
	var apiErr *gql.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Status == http.StatusNotFound {
			return errorf(http.StatusNotFound, codeNotFound, apiErr.Message)
		}
		s.logger.Warn("github request failed", "message", apiErr.Message, "status", apiErr.Status)
		return errorf(http.StatusBadGateway, codeGitHub, apiErr.Message)
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		// The webview went away; the response is never read.
		return errorf(http.StatusGatewayTimeout, codeGitHub, "GitHub request canceled")
	}
	s.logger.Error("github request failed", "err", err)
	return errorf(http.StatusBadGateway, codeGitHub, "GitHub request failed")
}

// encodeRawDiff stores a non-JSON diff as a JSON string so the cache entry
// stays valid JSON. decodeRawDiff is the inverse.
func encodeRawDiff(body []byte) json.RawMessage {
	encoded, err := json.Marshal(string(body))
	if err != nil {
		return nil
	}
	return encoded
}

func decodeRawDiff(raw json.RawMessage) ([]byte, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var body string
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, false
	}
	return []byte(body), true
}
