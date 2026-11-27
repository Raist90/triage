package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/Raist90/triage/backend/internal/gql"
)

// listConcurrency bounds in-flight repo requests for one list. Config is
// small, so the bound only stops a large config from opening a burst.
const listConcurrency = 6

// ListPRs runs one search per repo, concurrently. One request per repo keeps
// each query under GitHub's 10s execution limit; aliasing every repo into a
// single query makes big lists come back 502 after ~10s.
func (c *Client) ListPRs(ctx context.Context, tab, repo string, repos []string) (ListResult, error) {
	if !c.Configured() {
		return ListResult{}, &gql.APIError{Message: "GitHub is not configured"}
	}
	if len(repos) == 0 {
		return ListResult{PRs: []PR{}}, nil
	}

	type repoResult struct {
		viewer Viewer
		prs    []PR
		err    error
	}
	type indexedResult struct {
		index int
		repoResult
	}

	var wg sync.WaitGroup
	results := make(chan indexedResult, len(repos))
	sem := make(chan struct{}, listConcurrency)
	for index, name := range repos {
		wg.Add(1)
		go func(index int, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			viewer, prs, err := c.listRepo(ctx, tab, name)
			results <- indexedResult{index: index, repoResult: repoResult{viewer: viewer, prs: prs, err: err}}
		}(index, name)
	}
	wg.Wait()
	close(results)

	ordered := make([]repoResult, len(repos))
	for item := range results {
		ordered[item.index] = item.repoResult
	}

	result := ListResult{PRs: []PR{}}
	for _, item := range ordered {
		if item.err != nil {
			return ListResult{}, item.err
		}
		if result.Viewer.Login == "" {
			result.Viewer = item.viewer
		}
		for _, pr := range item.prs {
			if repo != "" && !strings.EqualFold(pr.Repo, repo) {
				continue
			}
			result.PRs = append(result.PRs, pr)
		}
	}
	return result, nil
}

// listRepo fetches and decodes one repo's search. It retries a provider 5xx
// once: GitHub's gateway answers 502 when a search runs long, and a second
// attempt usually lands after the first has warmed it.
func (c *Client) listRepo(ctx context.Context, tab, repo string) (Viewer, []PR, error) {
	query, err := buildRepoQuery(tab, repo)
	if err != nil {
		return Viewer{}, nil, &gql.APIError{Message: "could not build query"}
	}

	var data map[string]json.RawMessage
	for attempt := 0; ; attempt++ {
		err = c.gql.Do(ctx, query, nil, &data)
		if err == nil {
			break
		}
		var apiErr *gql.APIError
		if attempt == 0 && errors.As(err, &apiErr) && apiErr.Status >= 500 {
			continue
		}
		return Viewer{}, nil, err
	}

	var viewer Viewer
	if raw, ok := data["viewer"]; ok {
		_ = json.Unmarshal(raw, &viewer)
	}

	raw, ok := data["r0"]
	if !ok {
		return viewer, []PR{}, nil
	}
	var search searchResult
	if err := json.Unmarshal(raw, &search); err != nil {
		return Viewer{}, nil, &gql.APIError{Message: "provider returned unexpected data"}
	}

	prs := make([]PR, 0, len(search.Nodes))
	for _, node := range search.Nodes {
		if node.Typename != "PullRequest" {
			continue
		}
		pr := node.toPR()
		pr.ReviewRequested = node.requestedViewer(viewer.Login)
		prs = append(prs, pr)
	}
	return viewer, prs, nil
}

// searchResult is the decoded shape of the search field.
type searchResult struct {
	Nodes []prNode `json:"nodes"`
}

// buildRepoQuery emits the search for one repo. Repo names come from config,
// so they are quoted as GraphQL string literals rather than concatenated raw.
func buildRepoQuery(tab, repo string) (string, error) {
	terms, err := searchTerms(tab, repo)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("query {\n  viewer { login name }\n  r0: search(query: %s, type: ISSUE, first: %d) {\n    nodes {\n      __typename\n      ... on PullRequest {\n%s      }\n    }\n  }\n}\n",
		strconv.Quote(terms), searchPageSize, listFields), nil
}

// searchTerms maps a tab to GitHub search qualifiers.
func searchTerms(tab, repo string) (string, error) {
	if repo == "" {
		return "", errors.New("repo is empty")
	}
	terms := []string{"is:pr", "is:open", "repo:" + repo}
	switch tab {
	case TabMine:
		terms = append(terms, "author:@me")
	case TabReview:
		terms = append(terms, "review-requested:@me")
	case TabAll:
	default:
		return "", fmt.Errorf("unknown tab %q", tab)
	}
	return strings.Join(terms, " "), nil
}
