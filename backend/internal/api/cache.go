package api

import (
	"encoding/json"
	"time"

	"github.com/Raist90/triage/backend/internal/cache"
	"github.com/Raist90/triage/backend/internal/github"
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

// invalidateComments drops the cached inline-comment list for one PR.
func (s *Server) invalidateComments(owner, repo string, number int) {
	vars := prVars{Owner: owner, Repo: repo, Number: number}
	if key, err := cache.Key("github", "pr-comments", vars); err == nil {
		s.invalidateKey(key)
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
