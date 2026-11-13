// Package github fetches pull request metadata through GraphQL and diffs
// through REST. It never returns raw provider bodies or the bearer token.
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

const (
	graphqlEndpoint = "https://api.github.com/graphql"

	// searchPageSize caps one repo/tab result set.
	searchPageSize = 50

	// statusNone and reviewNone are the neutral values when GitHub reports no
	// check suite or no review decision.
	statusNone = "none"
	reviewNone = "none"
)

// Tab IDs are part of the Go/TS contract; config carries the labels.
const (
	TabMine   = "mine"
	TabReview = "review"
	TabAll    = "all"
)

// Viewer is the authenticated GitHub identity.
type Viewer struct {
	Login string `json:"login"`
	Name  string `json:"name"`
}

// PR is the list/detail shape shared by every route. Enums are normalized to
// lowercase so the webview never has to know GitHub's spelling.
type PR struct {
	Number      int    `json:"number"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	Author      string `json:"author"`
	Repo        string `json:"repo"`
	HeadSHA     string `json:"headSHA"`
	Branch      string `json:"branch"`
	BaseBranch  string `json:"baseBranch"`
	CheckStatus string `json:"checkStatus"`
	ReviewState string `json:"reviewState"`
	// ViewerReview is the viewer's latest review on the PR ("approved",
	// "changes_requested", ...). Detail responses only.
	ViewerReview string `json:"viewerReview,omitempty"`
	// ViewerLogin is the authenticated GitHub login. Detail responses only; the
	// diff UI uses it to show delete controls on the viewer's own comments.
	ViewerLogin string `json:"viewerLogin,omitempty"`
	// ViewerCanApprove is false for the author's own PR, where GitHub rejects
	// an approval. Detail responses only.
	ViewerCanApprove bool      `json:"viewerCanApprove,omitempty"`
	State            string    `json:"state"`
	Description      string    `json:"description"`
	Additions        int       `json:"additions"`
	Deletions        int       `json:"deletions"`
	ChangedFiles     int       `json:"changedFiles"`
	UpdatedAt        string    `json:"updatedAt"`
	IsDraft          bool      `json:"isDraft"`
	Comments         []Comment `json:"comments,omitempty"`
}

// Comment is one conversation or review-thread comment on a PR.
type Comment struct {
	Author    string `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	Kind      string `json:"kind"`
}

// ListResult is one tab scoped to either all tracked repos or a single repo.
type ListResult struct {
	Viewer Viewer `json:"viewer"`
	PRs    []PR   `json:"prs"`
}

// Client talks to GitHub with one token. An empty token is allowed; calls then
// fail with a clean APIError instead of panicking.
type Client struct {
	gql   *gql.Client
	token string
	web   *webClient
}

// NewClient returns a client. token may be empty.
func NewClient(token string) *Client {
	return &Client{
		gql:   gql.NewClient(graphqlEndpoint, token),
		token: token,
		web:   newWebClient(token),
	}
}

// Configured reports whether a token was resolved.
func (c *Client) Configured() bool { return c.token != "" }

// ValidateTab reports whether tab is one of the three supported IDs.
func ValidateTab(tab string) bool {
	switch tab {
	case TabMine, TabReview, TabAll:
		return true
	default:
		return false
	}
}

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
			if repo != "" && !strings.EqualFold(pr.Repo, repo) {
				continue
			}
			result.PRs = append(result.PRs, pr)
		}
	}
	return result, nil
}

// GetPR fetches one PR's metadata and description.
func (c *Client) GetPR(ctx context.Context, owner, repo string, number int) (PR, error) {
	if !c.Configured() {
		return PR{}, &gql.APIError{Message: "GitHub is not configured"}
	}

	vars := struct {
		Owner  string `json:"owner"`
		Name   string `json:"name"`
		Number int    `json:"number"`
	}{Owner: owner, Name: repo, Number: number}

	var data struct {
		Viewer struct {
			Login string `json:"login"`
		} `json:"viewer"`
		Repository struct {
			PullRequest *prNode `json:"pullRequest"`
		} `json:"repository"`
	}
	if err := c.gql.Do(ctx, detailQuery, vars, &data); err != nil {
		var apiErr *gql.APIError
		if errors.As(err, &apiErr) {
			for _, fieldErr := range apiErr.Errors {
				if fieldErr.Type == "NOT_FOUND" {
					return PR{}, &gql.APIError{Status: 404, Message: "pull request not found"}
				}
			}
		}
		return PR{}, err
	}
	if data.Repository.PullRequest == nil {
		return PR{}, &gql.APIError{Status: 404, Message: "pull request not found"}
	}
	pr := data.Repository.PullRequest.toPR()
	pr.ViewerReview = normalizeReviewState(data.Repository.PullRequest.ViewerLatestReview.State)
	pr.ViewerLogin = data.Viewer.Login
	pr.ViewerCanApprove = !strings.EqualFold(pr.Author, data.Viewer.Login)
	return pr, nil
}

// searchResult is the decoded shape of one aliased search field.
type searchResult struct {
	Nodes []prNode `json:"nodes"`
}

// prNode mirrors the GraphQL selection shared by list and detail queries.
type prNode struct {
	Typename           string `json:"__typename"`
	Number             int    `json:"number"`
	Title              string `json:"title"`
	URL                string `json:"url"`
	Body               string `json:"body"`
	State              string `json:"state"`
	IsDraft            bool   `json:"isDraft"`
	HeadRefName        string `json:"headRefName"`
	HeadRefOid         string `json:"headRefOid"`
	BaseRefName        string `json:"baseRefName"`
	ReviewDecision     string `json:"reviewDecision"`
	ViewerLatestReview struct {
		State string `json:"state"`
	} `json:"viewerLatestReview"`
	UpdatedAt    string `json:"updatedAt"`
	Additions    int    `json:"additions"`
	Deletions    int    `json:"deletions"`
	ChangedFiles int    `json:"changedFiles"`
	Author       struct {
		Login string `json:"login"`
	} `json:"author"`
	Repository struct {
		NameWithOwner string `json:"nameWithOwner"`
	} `json:"repository"`
	Commits struct {
		Nodes []struct {
			Commit struct {
				StatusCheckRollup *struct {
					State string `json:"state"`
				} `json:"statusCheckRollup"`
			} `json:"commit"`
		} `json:"nodes"`
	} `json:"commits"`
	Comments struct {
		Nodes []commentNode `json:"nodes"`
	} `json:"comments"`
	ReviewThreads struct {
		Nodes []struct {
			Comments struct {
				Nodes []commentNode `json:"nodes"`
			} `json:"comments"`
		} `json:"nodes"`
	} `json:"reviewThreads"`
}

type commentNode struct {
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	Author    struct {
		Login string `json:"login"`
	} `json:"author"`
}

func (n prNode) toPR() PR {
	check := statusNone
	if len(n.Commits.Nodes) > 0 {
		rollup := n.Commits.Nodes[0].Commit.StatusCheckRollup
		if rollup != nil && rollup.State != "" {
			check = strings.ToLower(rollup.State)
		}
	}

	review := reviewNone
	if n.ReviewDecision != "" {
		review = strings.ToLower(n.ReviewDecision)
	}

	comments := make([]Comment, 0, len(n.Comments.Nodes))
	for _, comment := range n.Comments.Nodes {
		comments = append(comments, comment.toComment("comment"))
	}
	for _, thread := range n.ReviewThreads.Nodes {
		for _, comment := range thread.Comments.Nodes {
			comments = append(comments, comment.toComment("review"))
		}
	}

	return PR{
		Number:       n.Number,
		Title:        n.Title,
		URL:          n.URL,
		Author:       n.Author.Login,
		Repo:         n.Repository.NameWithOwner,
		HeadSHA:      n.HeadRefOid,
		Branch:       n.HeadRefName,
		BaseBranch:   n.BaseRefName,
		CheckStatus:  check,
		ReviewState:  review,
		State:        strings.ToLower(n.State),
		Description:  n.Body,
		Additions:    n.Additions,
		Deletions:    n.Deletions,
		ChangedFiles: n.ChangedFiles,
		UpdatedAt:    n.UpdatedAt,
		IsDraft:      n.IsDraft,
		Comments:     comments,
	}
}

// normalizeReviewState maps GitHub's uppercase review enum to the lowercase
// contract; no review becomes "none".
func normalizeReviewState(state string) string {
	if state == "" {
		return reviewNone
	}
	return strings.ToLower(state)
}

func (c commentNode) toComment(kind string) Comment {
	return Comment{
		Author:    c.Author.Login,
		Body:      c.Body,
		CreatedAt: c.CreatedAt,
		Kind:      kind,
	}
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
