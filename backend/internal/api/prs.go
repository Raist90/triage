package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/diff"
	"github.com/Raist90/triage/backend/internal/github"
	"github.com/Raist90/triage/backend/internal/gql"
)

// repoPattern keeps path and query values to characters GitHub allows in an
// owner/name pair.
var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

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

// handlePRs serves GET /prs?tab=mine&repo=owner/name&refresh=1.
func (s *Server) handlePRs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET is allowed")
		return
	}

	tab := r.URL.Query().Get("tab")
	if !github.ValidateTab(tab) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "tab must be one of mine, review, all")
		return
	}

	repo := r.URL.Query().Get("repo")
	if repo != "" && !repoPattern.MatchString(repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return
	}

	repos := make([]string, 0, len(s.cfg.Repos))
	if repo != "" {
		repos = append(repos, repo)
	} else {
		for _, tracked := range s.cfg.Repos {
			repos = append(repos, tracked.Owner+"/"+tracked.Name)
		}
	}

	vars := listVars{Tab: tab, Repo: repo, Repos: repos}

	var result github.ListResult
	err := s.loadCached("prs", vars, s.cfg.Cache.GraphQL, isRefresh(r), &result, func() error {
		fetched, err := s.github.ListPRs(r.Context(), tab, repo, repos)
		if err != nil {
			return err
		}
		result = fetched
		return nil
	})
	if err != nil {
		s.writeProviderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// handlePR serves /pr/{owner}/{repo}/{number} plus its /diff, /review,
// /comments and /actions/{id}[/stream|/cancel] routes.
func (s *Server) handlePR(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/pr/"), "/")
	switch {
	case len(parts) == 3:
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET is allowed")
			return
		}
		s.handlePRDetail(w, r, parts[0], parts[1], parts[2])
	case len(parts) == 4 && parts[3] == "review":
		s.handleReview(w, r, parts[0], parts[1], parts[2])
	case len(parts) == 4 && parts[3] == "comments":
		s.handleComments(w, r, parts[0], parts[1], parts[2])
	case len(parts) == 4 && parts[3] == "draft":
		s.handlePRDraft(w, r, parts[0], parts[1], parts[2])
	case len(parts) == 4 && parts[3] == "merge":
		s.handlePRMerge(w, r, parts[0], parts[1], parts[2])
	case len(parts) == 5 && parts[3] == "comments":
		s.handleCommentDelete(w, r, parts[0], parts[1], parts[2], parts[4])
	case len(parts) == 4 && parts[3] == "diff":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, codeMethodNotAllowed, "only GET is allowed")
			return
		}
		s.handlePRDiff(w, r, parts[0], parts[1], parts[2])
	case len(parts) == 5 && parts[3] == "actions":
		s.handleAction(w, r, parts[0], parts[1], parts[2], parts[4])
	case len(parts) == 6 && parts[3] == "actions" && parts[5] == "stream":
		s.handleActionStream(w, r, parts[0], parts[1], parts[2], parts[4])
	case len(parts) == 6 && parts[3] == "actions" && parts[5] == "cancel":
		s.handleActionCancel(w, r, parts[0], parts[1], parts[2], parts[4])
	default:
		writeError(w, http.StatusNotFound, codeNotFound, "route not found")
	}
}

func (s *Server) handlePRDetail(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber string) {
	if !repoPattern.MatchString(owner + "/" + repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return
	}
	number, err := parseNumber(rawNumber)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "number must be a positive integer")
		return
	}

	vars := prVars{Owner: owner, Repo: repo, Number: number}

	var pr github.PR
	// v5 adds mergeability and whether squash merge is allowed.
	err = s.loadCached(prDetailRoute, vars, s.cfg.Cache.GraphQL, isRefresh(r), &pr, func() error {
		fetched, err := s.github.GetPR(r.Context(), owner, repo, number)
		if err != nil {
			return err
		}
		pr = fetched
		return nil
	})
	if err != nil {
		s.writeProviderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, prDetailResponse{PR: pr})
}

func (s *Server) handlePRDiff(w http.ResponseWriter, r *http.Request, owner, repo, rawNumber string) {
	if !repoPattern.MatchString(owner + "/" + repo) {
		writeError(w, http.StatusBadRequest, codeBadRequest, "repo must be owner/name")
		return
	}
	number, err := parseNumber(rawNumber)
	if err != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "number must be a positive integer")
		return
	}

	body, err := s.loadDiff(r.Context(), owner, repo, number, isRefresh(r))
	if err != nil {
		s.writeProviderError(w, err)
		return
	}
	writeDiff(w, r, body)
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

// writeProviderError maps provider failures to safe API envelopes. Provider
// bodies and tokens never reach the webview.
func (s *Server) writeProviderError(w http.ResponseWriter, err error) {
	var apiErr *gql.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Status == http.StatusNotFound {
			writeError(w, http.StatusNotFound, codeNotFound, apiErr.Message)
			return
		}
		s.logger.Warn("github request failed", "message", apiErr.Message, "status", apiErr.Status)
		writeError(w, http.StatusBadGateway, codeGitHub, apiErr.Message)
		return
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		// The webview went away; there is no one to answer.
		return
	}
	s.logger.Error("github request failed", "err", err)
	writeError(w, http.StatusBadGateway, codeGitHub, "GitHub request failed")
}

func isRefresh(r *http.Request) bool {
	value := r.URL.Query().Get("refresh")
	return value == "1" || value == "true"
}

func parseNumber(raw string) (int, error) {
	number, err := strconv.Atoi(raw)
	if err != nil || number <= 0 {
		return 0, errors.New("invalid number")
	}
	return number, nil
}

func writeDiff(w http.ResponseWriter, r *http.Request, body []byte) {
	files := diff.Parse(body)
	report, available := diff.Semantic(r.Context(), body)
	for index := range files {
		files[index].Kinds = diff.Kinds(files[index].Path)
		files[index].Semantic = report.Changes[files[index].Path]
		if !files[index].Binary {
			files[index].Hunks = diff.BuildHunksFor(files[index].Path, files[index].Patch)
			diff.Highlight(files[index].Path, files[index].Hunks)
		}
	}
	diff.Prioritize(files)
	response := diff.Response{Files: files, SemanticAvailable: available}
	if available {
		summary := report.Summary
		response.SemanticSummary = &summary
	}
	writeJSON(w, http.StatusOK, response)
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
