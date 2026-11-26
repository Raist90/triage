package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/Raist90/triage/backend/internal/gql"
)

// ListPRs runs one aliased search per repo, so a list costs exactly one HTTP
// request no matter how many repos are tracked.
func (c *Client) ListPRs(ctx context.Context, tab, repo string, repos []string) (ListResult, error) {
	if !c.Configured() {
		return ListResult{}, &gql.APIError{Message: "GitHub is not configured"}
	}
	if len(repos) == 0 {
		return ListResult{PRs: []PR{}}, nil
	}

	query, err := buildListQuery(tab, repos)
	if err != nil {
		return ListResult{}, &gql.APIError{Message: "could not build query"}
	}

	var data map[string]json.RawMessage
	if err := c.gql.Do(ctx, query, nil, &data); err != nil {
		return ListResult{}, err
	}

	result := ListResult{PRs: []PR{}}
	if raw, ok := data["viewer"]; ok {
		_ = json.Unmarshal(raw, &result.Viewer)
	}

	for index := range repos {
		raw, ok := data[fmt.Sprintf("r%d", index)]
		if !ok {
			continue
		}
		var search searchResult
		if err := json.Unmarshal(raw, &search); err != nil {
			return ListResult{}, &gql.APIError{Message: "provider returned unexpected data"}
		}
		for _, node := range search.Nodes {
			if node.Typename != "PullRequest" {
				continue
			}
			pr := node.toPR()
			pr.ReviewRequested = node.requestedViewer(result.Viewer.Login)
			if repo != "" && !strings.EqualFold(pr.Repo, repo) {
				continue
			}
			result.PRs = append(result.PRs, pr)
		}
	}
	return result, nil
}

// searchResult is the decoded shape of one aliased search field.
type searchResult struct {
	Nodes []prNode `json:"nodes"`
}

// buildListQuery emits one aliased search field per repo. Repo names come from
// config, so they are quoted as GraphQL string literals rather than concatenated
// raw.
func buildListQuery(tab string, repos []string) (string, error) {
	var b strings.Builder
	b.WriteString("query {\n  viewer { login name }\n")
	for index, repo := range repos {
		terms, err := searchTerms(tab, repo)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "  r%d: search(query: %s, type: ISSUE, first: %d) {\n    nodes {\n      __typename\n      ... on PullRequest {\n%s      }\n    }\n  }\n",
			index, strconv.Quote(terms), searchPageSize, listFields)
	}
	b.WriteString("}\n")
	return b.String(), nil
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
